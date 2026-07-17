import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DbClient } from "../db.ts";
import {
  DASHBOARD_ROLLUP_ADVISORY_LOCK_CLASS,
  DASHBOARD_ROLLUP_ADVISORY_LOCK_OBJECT,
  type DashboardRollupConfig,
} from "./rollup-config.ts";
import {
  DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE,
  buildGapSourceQuery,
  buildHistorySourceQuery,
  buildLiveSourceQuery,
  detectHistoryGaps,
  detectLiveGaps,
  gapBackoffSeconds,
  processDashboardRollupWorkItem,
  selectDashboardRollupWorkItem,
} from "./rollup-store.ts";
import type { DashboardSourceLogRow } from "./types.ts";

const config: DashboardRollupConfig = {
  workerEnabled: true,
  readsEnabled: false,
  batchSize: 100,
  pauseMs: 500,
  statementTimeoutMs: 5000,
};

const PROJECTION =
  /id,\s*created_at,\s*token_id,\s*token_name,\s*user_id,\s*username,\s*model_name,\s*channel_id,\s*channel_name,\s*prompt_tokens,\s*completion_tokens,\s*type,\s*use_time,\s*other/i;

function sourceRow(
  partial: Partial<DashboardSourceLogRow> & { id: string | number | bigint },
): DashboardSourceLogRow {
  return {
    id: partial.id,
    created_at: partial.created_at ?? 1_700_000_000,
    token_id: partial.token_id ?? 1,
    token_name: partial.token_name ?? "tok",
    user_id: partial.user_id ?? 2,
    username: partial.username ?? "alice",
    model_name: partial.model_name ?? "gpt",
    channel_id: partial.channel_id ?? 3,
    channel_name: partial.channel_name ?? "ch",
    prompt_tokens: partial.prompt_tokens ?? 10,
    completion_tokens: partial.completion_tokens ?? 5,
    type: partial.type ?? 2,
    use_time: partial.use_time ?? 1,
    other: partial.other ?? null,
  };
}

function createSequencedClient(
  handlers: Array<
    (text: string, values?: unknown[]) => { rows: Record<string, unknown>[]; rowCount?: number }
  >,
): { client: DbClient; statements: string[]; valuesLog: unknown[][] } {
  const statements: string[] = [];
  const valuesLog: unknown[][] = [];
  let i = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push(text);
      valuesLog.push(values ?? []);
      if (i >= handlers.length) {
        throw new Error(`Unexpected query #${i + 1}: ${text.slice(0, 160)}`);
      }
      return handlers[i++]!(text, values);
    },
  } as DbClient;
  return { client, statements, valuesLog };
}

type Dim = {
  id: string;
  version: number;
  dimension_mask: number;
  dimension_hash: Buffer;
  token_id: string | null;
  token_name: string | null;
  user_id: string | null;
  username: string | null;
  model_name: string | null;
  channel_id: string | null;
};

function makeSmartFake(options: {
  lock?: boolean;
  state?: Record<string, unknown>;
  latestId?: string | null;
  sourceRows?: DashboardSourceLogRow[];
  claimOnly?: string[];
  failOn?: "rollup" | null;
  forceDimensionCollision?: boolean;
  gapRow?: {
    gap_start_id: string;
    gap_end_id: string;
    next_probe_at: string;
    probe_attempts: number;
  };
  unprobedGapCount?: number;
  registry?: { active_version: number | null; building_version: number | null };
  previousActiveStateUpdates?: unknown[][];
}) {
  const statements: string[] = [];
  const valuesLog: unknown[][] = [];
  let nextDimId = 1;
  const dimsByHash = new Map<string, Dim>();
  let cursorUpdateCount = 0;
  let lastCursorValues: unknown[] | null = null;
  let lastRollupStmt = -1;
  let firstCursorStmt = -1;
  let registryActivation: unknown[] | null = null;
  const demoteUpdates: unknown[][] = [];
  const gapOps: string[] = [];

  const stateRow = {
    version: 1,
    source_table_oid: 4242,
    source_boundary_id: "100",
    live_cursor_id: "10",
    history_cursor_id: "11" as string | null,
    history_complete: false,
    status: "building",
    processed_rows: "0",
    malformed_other_rows: "0",
    processed_min_created_at: null as number | null,
    processed_max_created_at: null as number | null,
    last_error: null as string | null,
    ...(options.state ?? {}),
  };

  const registry = {
    active_version: options.registry?.active_version ?? null,
    building_version:
      options.registry?.building_version ??
      (stateRow.status === "building" ? Number(stateRow.version) : null),
  };

  function parseDimInsert(values: unknown[]) {
    const cols = 9;
    for (let i = 0; i + cols <= values.length; i += cols) {
      const version = Number(values[i]);
      const mask = Number(values[i + 1]);
      const hash = values[i + 2] as Buffer;
      const hex = Buffer.isBuffer(hash) ? hash.toString("hex") : String(hash);
      const key = `${version}:${hex}`;
      if (!dimsByHash.has(key)) {
        dimsByHash.set(key, {
          id: String(nextDimId++),
          version,
          dimension_mask: mask,
          dimension_hash: Buffer.isBuffer(hash) ? hash : Buffer.from(hex, "hex"),
          token_id:
            values[i + 3] === null || values[i + 3] === undefined
              ? null
              : String(values[i + 3]),
          token_name: (values[i + 4] as string | null) ?? null,
          user_id:
            values[i + 5] === null || values[i + 5] === undefined
              ? null
              : String(values[i + 5]),
          username: (values[i + 6] as string | null) ?? null,
          model_name: (values[i + 7] as string | null) ?? null,
          channel_id:
            values[i + 8] === null || values[i + 8] === undefined
              ? null
              : String(values[i + 8]),
        });
      }
    }
  }

  const client = {
    async query(text: string, values?: unknown[]) {
      const v = values ?? [];
      statements.push(text);
      valuesLog.push(v);
      const idx = statements.length - 1;

      if (/pg_try_advisory_xact_lock/i.test(text)) {
        return { rows: [{ pg_try_advisory_xact_lock: options.lock !== false }] };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [{ ...stateRow }] };
      }
      if (/pg_class|pg_attribute/i.test(text)) {
        return {
          rows: [
            {
              table_oid: 4242,
              id_exists: true,
              id_integer_compatible: true,
              id_not_null: true,
              id_unique_leading: true,
              created_at_exists: true,
              created_at_integer_compatible: true,
            },
          ],
        };
      }
      if (
        /FROM\s+logs/i.test(text) &&
        /ORDER BY\s+id\s+DESC\s+LIMIT\s+1/i.test(text) &&
        !/WHERE/i.test(text)
      ) {
        if (options.latestId === null) return { rows: [] };
        return { rows: [{ id: options.latestId ?? "100" }] };
      }
      if (/FROM\s+logs/i.test(text) && /WHERE/i.test(text)) {
        return {
          rows: (options.sourceRows ?? []) as unknown as Record<string, unknown>[],
        };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_processed_sources/i.test(text)) {
        const ids = (v[2] as Array<string | number | bigint>).map(String);
        const out: { source_id: string }[] = [];
        for (const id of ids) {
          if (options.claimOnly && !options.claimOnly.map(String).includes(id)) continue;
          out.push({ source_id: id });
        }
        return { rows: out };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_dimensions/i.test(text)) {
        parseDimInsert(v);
        return { rows: [], rowCount: 0 };
      }
      if (/FROM\s+dashboard_rollup_dimensions/i.test(text)) {
        const version = Number(v[0]);
        const hashes = v.slice(1);
        const rows: Dim[] = [];
        for (const h of hashes) {
          const hex = Buffer.isBuffer(h) ? h.toString("hex") : String(h);
          const key = `${version}:${hex}`;
          let row = dimsByHash.get(key);
          if (!row) {
            row = {
              id: String(nextDimId++),
              version,
              dimension_mask: 0,
              dimension_hash: Buffer.isBuffer(h) ? h : Buffer.from(hex, "hex"),
              token_id: null,
              token_name: null,
              user_id: null,
              username: null,
              model_name: null,
              channel_id: null,
            };
            dimsByHash.set(key, row);
          }
          if (options.forceDimensionCollision) {
            rows.push({
              ...row,
              token_id: "999",
              token_name: "collision",
              user_id: "999",
              username: "collision",
              model_name: "collision",
              channel_id: "999",
              dimension_mask: 15,
            });
          } else {
            rows.push(row);
          }
        }
        return { rows: rows as unknown as Record<string, unknown>[] };
      }
      if (/INSERT\s+INTO\s+dashboard_rollups/i.test(text)) {
        if (options.failOn === "rollup") throw new Error("rollup write failed");
        lastRollupStmt = idx;
        for (const val of v) {
          if (typeof val === "bigint") {
            assert.fail("bigint parameters must be decimal strings");
          }
        }
        if (/GREATEST\s*\(\s*dashboard_rollups\.representative_/i.test(text)) {
          assert.fail("bare GREATEST on nullable representative is null-propagating");
        }
        assert.match(text, /CASE|COALESCE/i);
        return { rows: [], rowCount: 0 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_id_gaps/i.test(text)) {
        gapOps.push(`insert:${JSON.stringify(v)}`);
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE\s+FROM\s+dashboard_rollup_id_gaps/i.test(text)) {
        gapOps.push(`delete:${JSON.stringify(v)}`);
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_id_gaps/i.test(text)) {
        gapOps.push(`update:${JSON.stringify(v)}`);
        return { rows: [], rowCount: 1 };
      }
      if (/count\(\*\)/i.test(text) && /dashboard_rollup_id_gaps/i.test(text) && /probe_attempts\s*=\s*0/i.test(text)) {
        return { rows: [{ c: String(options.unprobedGapCount ?? 0) }] };
      }
      if (/FROM\s+dashboard_rollup_id_gaps/i.test(text)) {
        return {
          rows: options.gapRow ? [{ ...options.gapRow }] : [],
        };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [
            {
              active_version: registry.active_version,
              building_version: registry.building_version,
            },
          ],
        };
      }
      if (/UPDATE\s+dashboard_rollup_state/i.test(text)) {
        if (String(text).includes("unhealthy") || v.includes("unhealthy")) {
          stateRow.status = "unhealthy";
          return { rows: [], rowCount: 1 };
        }
        if (String(text).includes("inactive") || v.includes("inactive")) {
          demoteUpdates.push(v);
          return { rows: [], rowCount: 1 };
        }
        if (String(text).includes("'active'") || v.includes("active")) {
          // may be activation status flip or other
        }
        cursorUpdateCount += 1;
        if (firstCursorStmt < 0) firstCursorStmt = idx;
        lastCursorValues = v;
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_registry/i.test(text)) {
        registryActivation = v;
        registry.active_version = Number(v[0]);
        registry.building_version = null;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text.slice(0, 200)}`);
    },
  } as DbClient;

  return {
    client,
    statements,
    valuesLog,
    get lastRollupStmt() {
      return lastRollupStmt;
    },
    get firstCursorStmt() {
      return firstCursorStmt;
    },
    get cursorUpdateCount() {
      return cursorUpdateCount;
    },
    get lastCursorValues() {
      return lastCursorValues;
    },
    get registryActivation() {
      return registryActivation;
    },
    demoteUpdates,
    gapOps,
    stateRow,
  };
}

describe("dashboard rollup store SQL builders", () => {
  it("live/history/gap queries are keyset bounded with LIMIT, projection, no OFFSET/JSON cast", () => {
    const live = buildLiveSourceQuery(BigInt(10), 100);
    const history = buildHistorySourceQuery(BigInt(10), BigInt(99), 100);
    const gap = buildGapSourceQuery(BigInt(1), BigInt(5), 100);

    for (const q of [live, history, gap]) {
      assert.match(q.text, /FROM\s+logs/i);
      assert.match(q.text, /LIMIT\s+\$\d+/i);
      assert.match(q.text, PROJECTION);
      assert.doesNotMatch(q.text, /OFFSET/i);
      assert.doesNotMatch(q.text, /::jsonb/i);
      assert.doesNotMatch(q.text, /regexp/i);
    }

    assert.match(live.text, /id\s*>\s*\$1/i);
    assert.match(live.text, /ORDER BY\s+id\s+ASC/i);
    assert.deepEqual(live.values, ["10", 100]);

    assert.match(history.text, /id\s*<\s*\$1/i);
    assert.match(history.text, /id\s*<=\s*\$2/i);
    assert.match(history.text, /ORDER BY\s+id\s+DESC/i);
    assert.deepEqual(history.values, ["10", "99", 100]);

    assert.match(gap.text, /id\s*>=\s*\$1/i);
    assert.match(gap.text, /id\s*<=\s*\$2/i);
    assert.match(gap.text, /ORDER BY\s+id\s+ASC/i);
    assert.deepEqual(gap.values, ["1", "5", 100]);
  });

  it("invalid builder limits throw", () => {
    assert.throws(() => buildLiveSourceQuery(BigInt(1), 0));
    assert.throws(() => buildLiveSourceQuery(BigInt(1), 1001));
    assert.throws(() => buildHistorySourceQuery(BigInt(1), BigInt(0), 1.5));
    assert.throws(() => buildGapSourceQuery(BigInt(1), BigInt(2), -1));
  });
});

describe("gap detection helpers", () => {
  it("live ascending detects skipped IDs between prior cursor and returned IDs", () => {
    const gaps = detectLiveGaps(BigInt(10), [BigInt(12), BigInt(15)]);
    assert.deepEqual(gaps, [
      { start: BigInt(11), end: BigInt(11) },
      { start: BigInt(13), end: BigInt(14) },
    ]);
  });

  it("history descending detects gaps between adjacent returned IDs", () => {
    const gaps = detectHistoryGaps([BigInt(20), BigInt(18), BigInt(15)], null);
    assert.deepEqual(gaps, [
      { start: BigInt(19), end: BigInt(19) },
      { start: BigInt(16), end: BigInt(17) },
    ]);
  });

  it("history with prior exclusive cursor records only in-batch gaps when first id is contiguous", () => {
    // exclusive cursor 21 => expected highest is 20; first returned is 20 => no leading gap
    const gaps = detectHistoryGaps([BigInt(20), BigInt(18), BigInt(15)], BigInt(21));
    assert.deepEqual(gaps, [
      { start: BigInt(19), end: BigInt(19) },
      { start: BigInt(16), end: BigInt(17) },
    ]);
  });

  it("history records leading cross-batch gap against prior exclusive cursor", () => {
    // exclusive cursor 4 => expected highest is 3; returned [2] => missing 3
    const gaps = detectHistoryGaps([BigInt(2)], BigInt(4));
    assert.deepEqual(gaps, [{ start: BigInt(3), end: BigInt(3) }]);
  });

  it("history empty batch at exclusive cursor >1 records terminal positive-ID interval", () => {
    const gaps = detectHistoryGaps([], BigInt(4));
    assert.deepEqual(gaps, [{ start: BigInt(1), end: BigInt(3) }]);
  });

  it("history null cursor or cursor <=1 produces no boundary/terminal gap", () => {
    assert.deepEqual(detectHistoryGaps([BigInt(2)], null), []);
    assert.deepEqual(detectHistoryGaps([], null), []);
    assert.deepEqual(detectHistoryGaps([], BigInt(1)), []);
    assert.deepEqual(detectHistoryGaps([], BigInt(0)), []);
    assert.deepEqual(detectHistoryGaps([BigInt(1)], BigInt(1)), []);
  });

  it("gapBackoffSeconds is exponential and capped at 3600", () => {
    assert.equal(gapBackoffSeconds(0), 1);
    assert.equal(gapBackoffSeconds(1), 2);
    assert.equal(gapBackoffSeconds(10), 1024);
    assert.equal(gapBackoffSeconds(11), 2048);
    assert.equal(gapBackoffSeconds(12), 3600);
    assert.equal(gapBackoffSeconds(20), 3600);
  });
});

describe("selectDashboardRollupWorkItem priority", () => {
  it("prefers active due gap over lagging live and never returns recent", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [{ gap_start_id: "3", gap_end_id: "5" }] }),
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.deepEqual(item, {
      lane: "gap",
      version: 1,
      gapStartId: BigInt(3),
      gapEndId: BigInt(5),
    });
    assert.notEqual((item as { lane: string }).lane, "recent");
  });

  it("returns active live only when latest source id lags past live_cursor", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }), // no due gap
      () => ({ rows: [{ id: "50" }] }), // latest > cursor
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.deepEqual(item, { lane: "live", version: 1 });
  });

  it("caught-up active falls through so building lagging live is selected", async () => {
    // latest is cached once: 100 == active cursor (caught up) but > building cursor 20
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "100",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }), // active no gap
      () => ({ rows: [{ id: "100" }] }), // latest lookup (cached for rest of select)
      () => ({
        rows: [
          {
            version: 2,
            status: "building",
            live_cursor_id: "20",
            history_cursor_id: "15",
            history_complete: false,
          },
        ],
      }),
      () => ({ rows: [] }), // building no gap
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.deepEqual(item, { lane: "live", version: 2 });
  });

  it("building history when incomplete and not lagging live", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: null, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 2,
            status: "building",
            live_cursor_id: "20",
            history_cursor_id: "15",
            history_complete: false,
          },
        ],
      }),
      () => ({ rows: [] }), // no gap
      () => ({ rows: [{ id: "20" }] }), // caught up live
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.deepEqual(item, { lane: "history", version: 2 });
  });

  it("building lagging live preferred over history when new logs arrive", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: null, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 2,
            status: "building",
            live_cursor_id: "20",
            history_cursor_id: "15",
            history_complete: false,
          },
        ],
      }),
      () => ({ rows: [] }),
      () => ({ rows: [{ id: "25" }] }), // lagging
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.deepEqual(item, { lane: "live", version: 2 });
  });

  it("active==building is a single candidate without duplicate state loads for lag check path", async () => {
    const { client, statements } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 1 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }),
      () => ({ rows: [{ id: "10" }] }), // caught up
      // may load state again for equal-version history check
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.equal(item, null);
    // Only one registry candidate path; gap+latest used once for the active role
    assert.ok(statements.filter((s) => /dashboard_rollup_registry/i.test(s)).length === 1);
  });

  it("building gap selected before building lagging live", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: null, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 2,
            status: "building",
            live_cursor_id: "20",
            history_cursor_id: "15",
            history_complete: false,
          },
        ],
      }),
      () => ({ rows: [{ gap_start_id: "1", gap_end_id: "2" }] }),
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000);
    assert.deepEqual(item, {
      lane: "gap",
      version: 2,
      gapStartId: BigInt(1),
      gapEndId: BigInt(2),
    });
  });

  it("default preference under continuous lag chooses live, not history", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }),
      () => ({ rows: [{ id: "999" }] }), // continuous lag
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000, "live");
    assert.deepEqual(item, { lane: "live", version: 1 });
  });

  it("backfill preference skips live and chooses building history under continuous lag", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
      // active: gap only (no live under backfill)
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }), // active no due gap
      // building
      () => ({
        rows: [
          {
            version: 2,
            status: "building",
            live_cursor_id: "20",
            history_cursor_id: "15",
            history_complete: false,
          },
        ],
      }),
      () => ({ rows: [] }), // building no due gap
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000, "backfill");
    assert.deepEqual(item, { lane: "history", version: 2 });
  });

  it("backfill preference with active==building incomplete returns history", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 1 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "building",
            live_cursor_id: "10",
            history_cursor_id: "8",
            history_complete: false,
          },
        ],
      }),
      () => ({ rows: [] }), // no due gap
      // equal-version history finalization path
      () => ({
        rows: [
          {
            version: 1,
            status: "building",
            live_cursor_id: "10",
            history_cursor_id: "8",
            history_complete: false,
          },
        ],
      }),
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000, "backfill");
    assert.deepEqual(item, { lane: "history", version: 1 });
  });

  it("backfill preference still honors due gaps first and never schedules inactive/unhealthy", async () => {
    // due gap on active wins even under backfill
    {
      const { client } = createSequencedClient([
        () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
        () => ({
          rows: [
            {
              version: 1,
              status: "active",
              live_cursor_id: "10",
              history_cursor_id: null,
              history_complete: true,
            },
          ],
        }),
        () => ({ rows: [{ gap_start_id: "3", gap_end_id: "4" }] }),
      ]);
      const item = await selectDashboardRollupWorkItem(client, 1000, "backfill");
      assert.deepEqual(item, {
        lane: "gap",
        version: 1,
        gapStartId: BigInt(3),
        gapEndId: BigInt(4),
      });
    }

    // inactive building + no healthy building history => null (no active history invention)
    {
      const { client } = createSequencedClient([
        () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
        () => ({
          rows: [
            {
              version: 1,
              status: "active",
              live_cursor_id: "10",
              history_cursor_id: null,
              history_complete: true,
            },
          ],
        }),
        () => ({ rows: [] }),
        () => ({
          rows: [
            {
              version: 2,
              status: "inactive",
              live_cursor_id: "20",
              history_cursor_id: "15",
              history_complete: false,
            },
          ],
        }),
      ]);
      const item = await selectDashboardRollupWorkItem(client, 1000, "backfill");
      assert.equal(item, null);
    }

    // unhealthy building skipped
    {
      const { client } = createSequencedClient([
        () => ({ rows: [{ active_version: null, building_version: 2 }] }),
        () => ({
          rows: [
            {
              version: 2,
              status: "unhealthy",
              live_cursor_id: "20",
              history_cursor_id: "15",
              history_complete: false,
            },
          ],
        }),
      ]);
      const item = await selectDashboardRollupWorkItem(client, 1000, "backfill");
      assert.equal(item, null);
    }
  });

  it("backfill preference returns null when building history already complete", async () => {
    const { client } = createSequencedClient([
      () => ({ rows: [{ active_version: 1, building_version: 2 }] }),
      () => ({
        rows: [
          {
            version: 1,
            status: "active",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }),
      () => ({
        rows: [
          {
            version: 2,
            status: "building",
            live_cursor_id: "20",
            history_cursor_id: null,
            history_complete: true,
          },
        ],
      }),
      () => ({ rows: [] }),
    ]);
    const item = await selectDashboardRollupWorkItem(client, 1000, "backfill");
    assert.equal(item, null);
  });
});

describe("processDashboardRollupWorkItem", () => {
  it("advisory lock false executes no source/catalog query and returns skipped", async () => {
    const { client, statements, valuesLog } = createSequencedClient([
      (text) => {
        assert.match(text, /pg_try_advisory_xact_lock/i);
        return { rows: [{ pg_try_advisory_xact_lock: false }] };
      },
    ]);
    const result = await processDashboardRollupWorkItem(
      client,
      { lane: "live", version: 1 },
      config,
      1000,
    );
    assert.equal(result.fetchedRows, 0);
    assert.equal(result.claimedRows, 0);
    assert.equal(result.skippedReason, "lock_unavailable");
    assert.equal(statements.length, 1);
    assert.deepEqual(valuesLog[0], [
      DASHBOARD_ROLLUP_ADVISORY_LOCK_CLASS,
      DASHBOARD_ROLLUP_ADVISORY_LOCK_OBJECT,
    ]);
  });

  it("inactive locked state returns version_inactive with no catalog/source query", async () => {
    const { client, statements } = createSequencedClient([
      () => ({ rows: [{ pg_try_advisory_xact_lock: true }] }),
      () => ({
        rows: [
          {
            version: 1,
            source_table_oid: 4242,
            source_boundary_id: "100",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
            status: "inactive",
            processed_rows: "0",
            malformed_other_rows: "0",
            processed_min_created_at: null,
            processed_max_created_at: null,
          },
        ],
      }),
    ]);
    const result = await processDashboardRollupWorkItem(
      client,
      { lane: "live", version: 1 },
      config,
      1000,
    );
    assert.equal(result.skippedReason, "version_inactive");
    assert.equal(result.fetchedRows, 0);
    assert.equal(result.claimedRows, 0);
    assert.equal(statements.length, 2);
    assert.ok(statements.every((s) => !/pg_class|pg_attribute/i.test(s)));
    assert.ok(statements.every((s) => !/\bFROM\s+logs\b/i.test(s)));
  });

  it("source OID mismatch marks unhealthy, returns skippedReason, no source batch", async () => {
    const order: string[] = [];
    const { client, statements } = createSequencedClient([
      () => ({ rows: [{ pg_try_advisory_xact_lock: true }] }),
      () => ({
        rows: [
          {
            version: 1,
            source_table_oid: 1111,
            source_boundary_id: "100",
            live_cursor_id: "10",
            history_cursor_id: null,
            history_complete: true,
            status: "active",
            processed_rows: "0",
            malformed_other_rows: "0",
            processed_min_created_at: null,
            processed_max_created_at: null,
          },
        ],
      }),
      () => {
        order.push("catalog");
        return {
          rows: [
            {
              table_oid: 4242,
              id_exists: true,
              id_integer_compatible: true,
              id_not_null: true,
              id_unique_leading: true,
              created_at_exists: true,
              created_at_integer_compatible: true,
            },
          ],
        };
      },
      (text) => {
        order.push("unhealthy");
        assert.match(text, /UPDATE\s+dashboard_rollup_state/i);
        assert.match(text, /unhealthy/i);
        return { rows: [], rowCount: 1 };
      },
    ]);
    const result = await processDashboardRollupWorkItem(
      client,
      { lane: "live", version: 1 },
      config,
      1000,
    );
    assert.equal(result.skippedReason, "source_unhealthy");
    assert.equal(result.fetchedRows, 0);
    assert.deepEqual(order, ["catalog", "unhealthy"]);
    const sourceBatch = statements.filter(
      (s) =>
        /FROM\s+logs/i.test(s) &&
        /WHERE/i.test(s) &&
        /LIMIT/i.test(s),
    );
    assert.equal(sourceBatch.length, 0);
  });

  it("latest ID regression marks unhealthy then returns skippedReason without throw", async () => {
    const order: string[] = [];
    const { client } = createSequencedClient([
      () => ({ rows: [{ pg_try_advisory_xact_lock: true }] }),
      () => ({
        rows: [
          {
            version: 1,
            source_table_oid: 4242,
            source_boundary_id: "100",
            live_cursor_id: "50",
            history_cursor_id: null,
            history_complete: true,
            status: "active",
            processed_rows: "0",
            malformed_other_rows: "0",
            processed_min_created_at: null,
            processed_max_created_at: null,
          },
        ],
      }),
      () => ({
        rows: [
          {
            table_oid: 4242,
            id_exists: true,
            id_integer_compatible: true,
            id_not_null: true,
            id_unique_leading: true,
            created_at_exists: true,
            created_at_integer_compatible: true,
          },
        ],
      }),
      (text) => {
        order.push("latest");
        assert.match(text, /ORDER BY\s+id\s+DESC\s+LIMIT\s+1/i);
        return { rows: [{ id: "10" }] };
      },
      (text) => {
        order.push("unhealthy");
        assert.match(text, /UPDATE\s+dashboard_rollup_state/i);
        assert.match(text, /unhealthy/i);
        return { rows: [], rowCount: 1 };
      },
    ]);
    const result = await processDashboardRollupWorkItem(
      client,
      { lane: "live", version: 1 },
      config,
      1000,
    );
    assert.equal(result.skippedReason, "source_unhealthy");
    assert.equal(result.fetchedRows, 0);
    assert.deepEqual(order, ["latest", "unhealthy"]);
  });

  it("claim SQL exact shape; only claimed rows produce rollups; all-conflict advances cursor", async () => {
    const rows = [sourceRow({ id: "11" }), sourceRow({ id: "12" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      claimOnly: [],
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    const claim = fake.statements.find((s) =>
      /INSERT\s+INTO\s+dashboard_rollup_processed_sources/i.test(s),
    );
    assert.ok(claim);
    assert.match(claim!, /unnest\(\$3::bigint\[\]\)/i);
    assert.match(claim!, /ON CONFLICT\s+DO NOTHING/i);
    assert.match(claim!, /RETURNING\s+source_id/i);

    assert.equal(result.fetchedRows, 2);
    assert.equal(result.claimedRows, 0);
    assert.equal(result.groupedCells, 0);
    assert.equal(result.liveCursorId, "12");
    assert.ok(fake.cursorUpdateCount >= 1);
    assert.equal(
      fake.statements.filter((s) => /INSERT\s+INTO\s+dashboard_rollups/i.test(s)).length,
      0,
    );
  });

  it("normalizes only claimed ids when mixed claim results", async () => {
    const rows = [sourceRow({ id: "11" }), sourceRow({ id: "12" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      claimOnly: ["12"],
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    assert.equal(result.fetchedRows, 2);
    assert.equal(result.claimedRows, 1);
    assert.equal(result.groupedCells, 24);
    assert.equal(result.liveCursorId, "12");
  });

  it("dimension collision mismatch throws before any rollup insert", async () => {
    const rows = [sourceRow({ id: "11" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      forceDimensionCollision: true,
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
    });

    await assert.rejects(
      () =>
        processDashboardRollupWorkItem(
          fake.client,
          { lane: "live", version: 1 },
          config,
          1_700_000_100,
        ),
      /collision|mismatch/i,
    );
    assert.equal(
      fake.statements.filter((s) => /INSERT\s+INTO\s+dashboard_rollups/i.test(s)).length,
      0,
    );
  });

  it("cell upserts chunk when over write chunk size and bind bigint strings", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      sourceRow({
        id: String(11 + i),
        user_id: i + 1,
        username: `u${i}`,
        token_id: i + 1,
        token_name: `t${i}`,
        model_name: `m${i}`,
        channel_id: i + 1,
      }),
    );
    const fake = makeSmartFake({
      sourceRows: rows,
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "1000",
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    const rollupInserts = fake.statements.filter((s) =>
      /INSERT\s+INTO\s+dashboard_rollups/i.test(s),
    );
    assert.ok(rollupInserts.length >= 2, `expected chunked rollups, got ${rollupInserts.length}`);
    assert.ok(result.groupedCells > DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE);
    assert.equal(result.claimedRows, 10);
  });

  it("cursor update occurs after all rollup chunks", async () => {
    const rows = [sourceRow({ id: "11" }), sourceRow({ id: "12" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
    });

    await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    assert.ok(fake.lastRollupStmt >= 0);
    assert.ok(fake.firstCursorStmt > fake.lastRollupStmt);
  });

  it("rollup write failure means no cursor update is issued", async () => {
    const rows = [sourceRow({ id: "11" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      failOn: "rollup",
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
    });

    await assert.rejects(
      () =>
        processDashboardRollupWorkItem(
          fake.client,
          { lane: "live", version: 1 },
          config,
          1_700_000_100,
        ),
      /rollup write failed/,
    );
    assert.equal(fake.cursorUpdateCount, 0);
  });

  it("live gap detection creates bounded ranges for skipped IDs", async () => {
    const rows = [sourceRow({ id: "12" }), sourceRow({ id: "15" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
    });

    await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    assert.ok(
      fake.gapOps.some((g) => g.startsWith("insert:")),
      `expected gap inserts, got ${JSON.stringify(fake.gapOps)}`,
    );
  });

  it("empty gap probe schedules exponential backoff capped at 3600", async () => {
    const now = 1000;
    const fake = makeSmartFake({
      sourceRows: [],
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
      gapRow: {
        gap_start_id: "3",
        gap_end_id: "5",
        next_probe_at: "0",
        probe_attempts: 12,
      },
    });

    await processDashboardRollupWorkItem(
      fake.client,
      { lane: "gap", version: 1, gapStartId: BigInt(3), gapEndId: BigInt(5) },
      config,
      now,
    );

    const updates = fake.gapOps.filter((g) => g.startsWith("update:"));
    assert.ok(updates.length >= 1, `expected gap backoff update, got ${JSON.stringify(fake.gapOps)}`);
    // attempts become 13, backoff capped at 3600 => next_probe_at = 1000+3600
    assert.ok(updates.some((u) => u.includes(String(now + 3600))));
  });

  it("found gap rows shrink/delete interval and claim once", async () => {
    const rows = [sourceRow({ id: "3" }), sourceRow({ id: "4" })];
    const fake = makeSmartFake({
      sourceRows: rows,
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "100",
      gapRow: {
        gap_start_id: "3",
        gap_end_id: "5",
        next_probe_at: "0",
        probe_attempts: 0,
      },
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "gap", version: 1, gapStartId: BigInt(3), gapEndId: BigInt(5) },
      config,
      1_700_000_100,
    );

    assert.equal(result.fetchedRows, 2);
    assert.equal(result.claimedRows, 2);
    assert.ok(
      fake.gapOps.some(
        (g) => g.startsWith("delete:") || g.startsWith("update:") || g.startsWith("insert:"),
      ),
      `gap ops: ${JSON.stringify(fake.gapOps)}`,
    );
  });

  it("history batch with prior exclusive cursor records leading cross-batch gap before cursor update", async () => {
    const fake = makeSmartFake({
      sourceRows: [sourceRow({ id: "2" })],
      state: {
        status: "building",
        history_complete: false,
        history_cursor_id: "4",
        source_boundary_id: "5",
        live_cursor_id: "5",
      },
      latestId: "5",
      unprobedGapCount: 0,
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "history", version: 1 },
      config,
      1_700_000_100,
    );

    assert.equal(result.fetchedRows, 1);
    assert.equal(result.historyCursorId, "2");
    const leadingGapInsert = fake.gapOps.find((g) => g.startsWith("insert:"));
    assert.ok(leadingGapInsert, `expected gap insert, got: ${JSON.stringify(fake.gapOps)}`);
    // values: [version, start, end, next_probe_at]
    assert.match(leadingGapInsert!, /"3".*"3"|\[1,"3","3"/);
    const insertValues = fake.valuesLog.find(
      (_v, i) => /INSERT\s+INTO\s+dashboard_rollup_id_gaps/i.test(fake.statements[i] ?? ""),
    );
    assert.ok(insertValues);
    assert.equal(String(insertValues![1]), "3");
    assert.equal(String(insertValues![2]), "3");
    assert.ok(
      fake.firstCursorStmt > fake.statements.findIndex((s) =>
        /INSERT\s+INTO\s+dashboard_rollup_id_gaps/i.test(s),
      ),
      "gap insert must occur before history cursor update",
    );
  });

  it("empty history sets null cursor but history_complete only without unprobed gaps", async () => {
    const incomplete = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: false,
        history_cursor_id: "11",
        live_cursor_id: "100",
      },
      latestId: "100",
      unprobedGapCount: 1,
    });

    const blocked = await processDashboardRollupWorkItem(
      incomplete.client,
      { lane: "history", version: 1 },
      config,
      1_700_000_100,
    );
    assert.equal(blocked.historyCursorId, null);
    assert.equal(blocked.historyComplete, false);
    assert.equal(blocked.fetchedRows, 0);

    const ready = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: false,
        history_cursor_id: "11",
        live_cursor_id: "100",
      },
      latestId: "100",
      unprobedGapCount: 0,
    });
    const completed = await processDashboardRollupWorkItem(
      ready.client,
      { lane: "history", version: 1 },
      config,
      1_700_000_100,
    );
    assert.equal(completed.historyCursorId, null);
    assert.equal(completed.historyComplete, true);
  });

  it("history finalization with cursor null completes only after unprobed gaps cleared", async () => {
    const blocked = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: false,
        history_cursor_id: null,
        live_cursor_id: "100",
      },
      latestId: "100",
      unprobedGapCount: 2,
    });
    const r1 = await processDashboardRollupWorkItem(
      blocked.client,
      { lane: "history", version: 1 },
      config,
      1_700_000_100,
    );
    assert.equal(r1.historyComplete, false);
    assert.equal(blocked.registryActivation, null);

    const ready = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: false,
        history_cursor_id: null,
        live_cursor_id: "100",
      },
      latestId: "100",
      unprobedGapCount: 0,
      registry: { active_version: null, building_version: 1 },
    });
    const r2 = await processDashboardRollupWorkItem(
      ready.client,
      { lane: "history", version: 1 },
      config,
      1_700_000_100,
    );
    assert.equal(r2.historyComplete, true);
    assert.ok(ready.registryActivation, "expected activation after unprobed gaps cleared");
  });

  it("activation requires history complete plus live caught up and demotes prior active", async () => {
    const fake = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "100",
        source_boundary_id: "100",
        version: 2,
      },
      latestId: "100",
      unprobedGapCount: 0,
      registry: { active_version: 1, building_version: 2 },
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 2 },
      config,
      1_700_000_100,
    );

    assert.ok(fake.registryActivation, "expected registry activation");
    assert.ok(
      fake.demoteUpdates.length >= 1 ||
        fake.statements.some((s) => /inactive/i.test(s)),
      "expected previous active demotion to inactive",
    );
    assert.equal(result.historyComplete, true);
    assert.equal(result.lagIdSpan, "0");
  });

  it("not caught up does not activate", async () => {
    const fake = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "50",
      },
      latestId: "100",
      unprobedGapCount: 0,
    });

    await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    assert.equal(fake.registryActivation, null);
  });

  it("unprobed gaps block activation even when history flag already true", async () => {
    const fake = makeSmartFake({
      sourceRows: [],
      state: {
        status: "building",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "100",
      },
      latestId: "100",
      unprobedGapCount: 1,
      registry: { active_version: null, building_version: 1 },
    });

    await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );
    assert.equal(fake.registryActivation, null);
  });

  it("malformed and processed counters increase only for claimed rows", async () => {
    const rows = [
      sourceRow({ id: "11", other: "{not-json" }),
      sourceRow({ id: "12", other: null }),
    ];
    const fake = makeSmartFake({
      sourceRows: rows,
      claimOnly: ["11"],
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
        processed_rows: "0",
        malformed_other_rows: "0",
      },
      latestId: "100",
    });

    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1_700_000_100,
    );

    assert.equal(result.claimedRows, 1);
    assert.equal(result.malformedOtherRows, 1);
  });

  it("write chunk size constant is 200", () => {
    assert.equal(DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE, 200);
  });

  it("durationMs is nonnegative", async () => {
    const fake = makeSmartFake({
      sourceRows: [],
      state: {
        status: "active",
        history_complete: true,
        history_cursor_id: null,
        live_cursor_id: "10",
      },
      latestId: "10",
    });
    const result = await processDashboardRollupWorkItem(
      fake.client,
      { lane: "live", version: 1 },
      config,
      1000,
    );
    assert.ok(result.durationMs >= 0);
  });
});
