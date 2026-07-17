import type { DbClient } from "../db.ts";
import {
  DASHBOARD_ROLLUP_ADVISORY_LOCK_CLASS,
  DASHBOARD_ROLLUP_ADVISORY_LOCK_OBJECT,
  type DashboardRollupConfig,
} from "./rollup-config.ts";
import {
  accumulateNormalizedDashboardRows,
  assertDimensionKeyMatchesStored,
  getDashboardRollupFormula,
} from "./rollup-normalizer.ts";
import { inspectDashboardSourceSchema } from "./rollup-schema.ts";
import type {
  DashboardDimensionKey,
  DashboardRollupBatchResult,
  DashboardRollupWorkItem,
  DashboardSourceLogRow,
  HashedDashboardDimensionKey,
  PendingDashboardRollupCell,
} from "./types.ts";

export const DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE = 200;

export interface DashboardSqlQuery {
  text: string;
  values: unknown[];
}

export interface IdGapRange {
  start: bigint;
  end: bigint;
}

const SOURCE_PROJECTION = `
  id, created_at, token_id, token_name, user_id, username, model_name,
  channel_id, channel_name, prompt_tokens, completion_tokens, type, use_time, other
`.replace(/\s+/g, " ").trim();

function assertBuilderLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error(`dashboard rollup source query limit must be an integer 1..1000, got ${String(limit)}`);
  }
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") return BigInt(value);
  throw new Error(`Expected bigint-compatible value, got ${String(value)}`);
}

function asNullableBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  return asBigInt(value);
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (typeof value === "bigint") return Number(value);
  return fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

function decimalString(value: bigint | number): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function finiteNumberString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite numeric bind: ${String(value)}`);
  }
  return String(value);
}

export function buildLiveSourceQuery(cursorId: bigint, limit: number): DashboardSqlQuery {
  assertBuilderLimit(limit);
  return {
    text: `SELECT ${SOURCE_PROJECTION} FROM logs WHERE id > $1 ORDER BY id ASC LIMIT $2`,
    values: [decimalString(cursorId), limit],
  };
}

export function buildHistorySourceQuery(
  historyCursorId: bigint,
  boundaryId: bigint,
  limit: number,
): DashboardSqlQuery {
  assertBuilderLimit(limit);
  return {
    text: `SELECT ${SOURCE_PROJECTION} FROM logs WHERE id < $1 AND id <= $2 ORDER BY id DESC LIMIT $3`,
    values: [decimalString(historyCursorId), decimalString(boundaryId), limit],
  };
}

export function buildGapSourceQuery(
  gapStartId: bigint,
  gapEndId: bigint,
  limit: number,
): DashboardSqlQuery {
  assertBuilderLimit(limit);
  return {
    text: `SELECT ${SOURCE_PROJECTION} FROM logs WHERE id >= $1 AND id <= $2 ORDER BY id ASC LIMIT $3`,
    values: [decimalString(gapStartId), decimalString(gapEndId), limit],
  };
}

/** Live ascending: gaps between priorCursor+1 and first/adjacent returned IDs. */
export function detectLiveGaps(priorCursorId: bigint, fetchedIdsAsc: bigint[]): IdGapRange[] {
  const gaps: IdGapRange[] = [];
  if (fetchedIdsAsc.length === 0) return gaps;

  let expected = priorCursorId + BigInt(1);
  for (const id of fetchedIdsAsc) {
    if (id > expected) {
      gaps.push({ start: expected, end: id - BigInt(1) });
    }
    if (id >= expected) {
      expected = id + BigInt(1);
    }
  }
  return gaps.filter((g) => g.start <= g.end);
}

/**
 * History descending gap detection.
 * `priorCursorExclusive` is the exclusive upper cursor used for the batch
 * (history_cursor_id before the walk). Leading holes between that cursor and the
 * first (highest) returned ID, adjacent holes inside the batch, and the terminal
 * empty-walk interval [1, cursor-1] are all recorded so late-committing IDs can
 * be claimed via the gap lane.
 */
export function detectHistoryGaps(
  fetchedIdsDesc: bigint[],
  priorCursorExclusive: bigint | null,
): IdGapRange[] {
  const gaps: IdGapRange[] = [];

  if (fetchedIdsDesc.length === 0) {
    if (priorCursorExclusive !== null && priorCursorExclusive > BigInt(1)) {
      gaps.push({ start: BigInt(1), end: priorCursorExclusive - BigInt(1) });
    }
    return gaps.filter((g) => g.start <= g.end);
  }

  // Leading / cross-batch gap: expected highest is priorCursorExclusive - 1.
  if (priorCursorExclusive !== null && priorCursorExclusive > BigInt(1)) {
    const first = fetchedIdsDesc[0]!;
    const expectedHighest = priorCursorExclusive - BigInt(1);
    if (first < expectedHighest) {
      gaps.push({ start: first + BigInt(1), end: expectedHighest });
    }
  }

  for (let i = 0; i < fetchedIdsDesc.length - 1; i++) {
    const higher = fetchedIdsDesc[i]!;
    const lower = fetchedIdsDesc[i + 1]!;
    // DESC: higher should be adjacent above lower
    if (higher > lower + BigInt(1)) {
      gaps.push({ start: lower + BigInt(1), end: higher - BigInt(1) });
    }
  }
  return gaps.filter((g) => g.start <= g.end);
}

/**
 * Exponential backoff seconds, capped at one hour.
 * Formula: min(3600, 2^min(attempts,12)) so attempts 0..11 grow as powers of two
 * and attempts >= 12 clamp at 3600 (2^12 would be 4096).
 */
export function gapBackoffSeconds(attempts: number): number {
  const exp = Math.min(Math.max(0, Math.trunc(attempts)), 12);
  return Math.min(3600, 2 ** exp);
}

interface VersionStateRow {
  version: number;
  source_table_oid: number;
  source_boundary_id: string | number | bigint;
  live_cursor_id: string | number | bigint;
  history_cursor_id: string | number | bigint | null;
  history_complete: boolean | string;
  status: string;
  processed_rows: string | number | bigint;
  malformed_other_rows: string | number | bigint;
  processed_min_created_at: string | number | bigint | null;
  processed_max_created_at: string | number | bigint | null;
}

type VersionStatus = "building" | "active" | "inactive" | "unhealthy";

interface LoadedState {
  version: number;
  sourceTableOid: number;
  sourceBoundaryId: bigint;
  liveCursorId: bigint;
  historyCursorId: bigint | null;
  historyComplete: boolean;
  status: VersionStatus;
  processedRows: bigint;
  malformedOtherRows: bigint;
  processedMinCreatedAt: number | null;
  processedMaxCreatedAt: number | null;
}

function mapState(row: VersionStateRow): LoadedState {
  const status = row.status;
  if (
    status !== "building" &&
    status !== "active" &&
    status !== "inactive" &&
    status !== "unhealthy"
  ) {
    throw new Error(`Unexpected dashboard rollup status: ${status}`);
  }
  return {
    version: asNumber(row.version),
    sourceTableOid: asNumber(row.source_table_oid),
    sourceBoundaryId: asBigInt(row.source_boundary_id),
    liveCursorId: asBigInt(row.live_cursor_id),
    historyCursorId: asNullableBigInt(row.history_cursor_id),
    historyComplete: asBoolean(row.history_complete),
    status,
    processedRows: asBigInt(row.processed_rows ?? 0),
    malformedOtherRows: asBigInt(row.malformed_other_rows ?? 0),
    processedMinCreatedAt:
      row.processed_min_created_at === null || row.processed_min_created_at === undefined
        ? null
        : asNumber(row.processed_min_created_at),
    processedMaxCreatedAt:
      row.processed_max_created_at === null || row.processed_max_created_at === undefined
        ? null
        : asNumber(row.processed_max_created_at),
  };
}

async function loadDueGap(
  client: DbClient,
  version: number,
  nowSeconds: number,
): Promise<{ gapStartId: bigint; gapEndId: bigint } | null> {
  const result = await client.query(
    `SELECT gap_start_id, gap_end_id
     FROM dashboard_rollup_id_gaps
     WHERE version = $1 AND next_probe_at <= $2
     ORDER BY next_probe_at ASC, gap_start_id ASC
     LIMIT 1`,
    [version, nowSeconds],
  );
  const row = result.rows[0] as
    | { gap_start_id: string | number | bigint; gap_end_id: string | number | bigint }
    | undefined;
  if (!row) return null;
  return {
    gapStartId: asBigInt(row.gap_start_id),
    gapEndId: asBigInt(row.gap_end_id),
  };
}

async function loadVersionStateLite(
  client: DbClient,
  version: number,
): Promise<{
  version: number;
  status: string;
  live_cursor_id: string | number | bigint;
  history_cursor_id: string | number | bigint | null;
  history_complete: boolean | string;
} | null> {
  const result = await client.query(
    `SELECT version, status, live_cursor_id, history_cursor_id, history_complete
     FROM dashboard_rollup_state
     WHERE version = $1`,
    [version],
  );
  return (
    (result.rows[0] as {
      version: number;
      status: string;
      live_cursor_id: string | number | bigint;
      history_cursor_id: string | number | bigint | null;
      history_complete: boolean | string;
    } | undefined) ?? null
  );
}

async function loadLatestSourceId(client: DbClient): Promise<bigint | null> {
  const result = await client.query(`SELECT id FROM logs ORDER BY id DESC LIMIT 1`);
  const row = result.rows[0] as { id: string | number | bigint } | undefined;
  return row ? asBigInt(row.id) : null;
}

async function countUnprobedGaps(client: DbClient, version: number): Promise<number> {
  const result = await client.query(
    `SELECT count(*)::text AS c
     FROM dashboard_rollup_id_gaps
     WHERE version = $1 AND probe_attempts = 0`,
    [version],
  );
  return asNumber((result.rows[0] as { c: string } | undefined)?.c, 0);
}

export type DashboardRollupWorkPreference = "live" | "backfill";

/**
 * Work priority (healthy versions only):
 * 1 active due gap
 * 2 active lagging live (latest source id > live_cursor) — skipped when preference=backfill
 * 3 building due gap
 * 4 building lagging live — skipped when preference=backfill
 * 5 building history / finalization when incomplete
 *
 * `preference: "backfill"` still honors due gaps first, but skips live opportunities
 * so a worker can force history/finalization under continuous live lag.
 * Live is returned only when the version is lagging. Caught-up active does not
 * shadow building work forever. Identical active/building is one candidate.
 * Never returns recent. Never schedules inactive/unhealthy versions.
 */
export async function selectDashboardRollupWorkItem(
  client: DbClient,
  nowSeconds: number,
  preference: DashboardRollupWorkPreference = "live",
): Promise<DashboardRollupWorkItem | null> {
  const reg = await client.query(
    `SELECT active_version, building_version
     FROM dashboard_rollup_registry
     WHERE singleton = TRUE`,
  );
  const row = reg.rows[0] as
    | { active_version: number | null; building_version: number | null }
    | undefined;
  if (!row) return null;

  const activeVersion =
    row.active_version === null || row.active_version === undefined
      ? null
      : asNumber(row.active_version);
  const buildingVersion =
    row.building_version === null || row.building_version === undefined
      ? null
      : asNumber(row.building_version);

  // Deduplicate when active == building.
  const ordered: Array<{ version: number; role: "active" | "building" }> = [];
  if (activeVersion !== null) {
    ordered.push({ version: activeVersion, role: "active" });
  }
  if (buildingVersion !== null && buildingVersion !== activeVersion) {
    ordered.push({ version: buildingVersion, role: "building" });
  }

  // Cache one latest lookup for the whole select pass (only needed for live lag checks).
  let latestId: bigint | null | undefined;

  async function latest(): Promise<bigint | null> {
    if (latestId === undefined) {
      latestId = await loadLatestSourceId(client);
    }
    return latestId;
  }

  async function tryDueGap(version: number): Promise<DashboardRollupWorkItem | null> {
    const gap = await loadDueGap(client, version, nowSeconds);
    if (!gap) return null;
    return {
      lane: "gap",
      version,
      gapStartId: gap.gapStartId,
      gapEndId: gap.gapEndId,
    };
  }

  async function isLagging(liveCursorId: bigint): Promise<boolean> {
    const id = await latest();
    return id !== null && id > liveCursorId;
  }

  function isSchedulable(status: string): boolean {
    return status !== "unhealthy" && status !== "inactive";
  }

  // 1-2: active gap then (optional) lagging live
  for (const c of ordered.filter((x) => x.role === "active")) {
    const state = await loadVersionStateLite(client, c.version);
    if (!state || !isSchedulable(state.status)) continue;
    const gapItem = await tryDueGap(c.version);
    if (gapItem) return gapItem;
    if (preference === "live" && (await isLagging(asBigInt(state.live_cursor_id)))) {
      return { lane: "live", version: c.version };
    }
  }

  // 3-5: building gap, (optional) lagging live, then history/finalization
  for (const c of ordered.filter((x) => x.role === "building")) {
    const state = await loadVersionStateLite(client, c.version);
    if (!state || !isSchedulable(state.status)) continue;
    const gapItem = await tryDueGap(c.version);
    if (gapItem) return gapItem;
    if (preference === "live" && (await isLagging(asBigInt(state.live_cursor_id)))) {
      return { lane: "live", version: c.version };
    }
    if (!asBoolean(state.history_complete)) {
      // History walk or finalization (cursor null with unprobed gaps / incomplete flag)
      return { lane: "history", version: c.version };
    }
  }

  // When active==building and was listed as active only, still need history if incomplete.
  // This is building history (same version), not "active-only history".
  if (activeVersion !== null && buildingVersion === activeVersion) {
    const state = await loadVersionStateLite(client, activeVersion);
    if (state && isSchedulable(state.status) && !asBoolean(state.history_complete)) {
      return { lane: "history", version: activeVersion };
    }
  }

  return null;
}

async function upsertGapRanges(
  client: DbClient,
  version: number,
  gaps: IdGapRange[],
  nowSeconds: number,
): Promise<void> {
  for (const gap of gaps) {
    if (gap.start > gap.end) continue;
    // Coalesce simple identical PK via ON CONFLICT DO NOTHING / update next_probe if exists
    await client.query(
      `INSERT INTO dashboard_rollup_id_gaps (version, gap_start_id, gap_end_id, next_probe_at, probe_attempts)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (version, gap_start_id, gap_end_id) DO NOTHING`,
      [version, decimalString(gap.start), decimalString(gap.end), nowSeconds],
    );
  }
}

async function claimSourceIds(
  client: DbClient,
  version: number,
  sourceIds: bigint[],
  nowSeconds: number,
): Promise<bigint[]> {
  if (sourceIds.length === 0) return [];
  const result = await client.query(
    `INSERT INTO dashboard_rollup_processed_sources(version,source_id,processed_at)
     SELECT $1, source_id, $2
     FROM unnest($3::bigint[]) AS claimed(source_id)
     ON CONFLICT DO NOTHING
     RETURNING source_id`,
    [version, nowSeconds, sourceIds.map((id) => decimalString(id))],
  );
  return (result.rows as Array<{ source_id: string | number | bigint }>).map((r) =>
    asBigInt(r.source_id),
  );
}

async function resolveDimensions(
  client: DbClient,
  version: number,
  dimensions: HashedDashboardDimensionKey[],
): Promise<Map<string, bigint>> {
  const idByHash = new Map<string, bigint>();
  if (dimensions.length === 0) return idByHash;

  for (let i = 0; i < dimensions.length; i += DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE) {
    const chunk = dimensions.slice(i, i + DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const dim of chunk) {
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
      );
      values.push(
        version,
        dim.dimensionMask,
        dim.hash,
        dim.tokenId === null ? null : decimalString(dim.tokenId),
        dim.tokenName,
        dim.userId === null ? null : decimalString(dim.userId),
        dim.username,
        dim.modelName,
        dim.channelId === null ? null : decimalString(dim.channelId),
      );
    }
    await client.query(
      `INSERT INTO dashboard_rollup_dimensions (
         version, dimension_mask, dimension_hash,
         token_id, token_name, user_id, username, model_name, channel_id
       ) VALUES ${placeholders.join(",")}
       ON CONFLICT (version, dimension_hash) DO NOTHING`,
      values,
    );

    const selectValues: unknown[] = [version];
    const hashPlaceholders: string[] = [];
    let sp = 2;
    for (const dim of chunk) {
      hashPlaceholders.push(`$${sp++}`);
      selectValues.push(dim.hash);
    }
    const selected = await client.query(
      `SELECT id, version, dimension_mask, dimension_hash,
              token_id, token_name, user_id, username, model_name, channel_id
       FROM dashboard_rollup_dimensions
       WHERE version = $1 AND dimension_hash IN (${hashPlaceholders.join(",")})`,
      selectValues,
    );

    const byHex = new Map<string, (typeof selected.rows)[0]>();
    for (const row of selected.rows as Array<Record<string, unknown>>) {
      const hash = row.dimension_hash;
      const hex = Buffer.isBuffer(hash)
        ? hash.toString("hex")
        : Buffer.from(hash as Uint8Array).toString("hex");
      byHex.set(hex, row);
    }

    for (const dim of chunk) {
      const hex = dim.hash.toString("hex");
      const stored = byHex.get(hex) as Record<string, unknown> | undefined;
      if (!stored) {
        throw new Error(`dashboard dimension mapping missing for hash ${hex}`);
      }
      const storedKey: DashboardDimensionKey = {
        dimensionMask: asNumber(stored.dimension_mask) as DashboardDimensionKey["dimensionMask"],
        tokenId: asNullableBigInt(stored.token_id),
        tokenName: (stored.token_name as string | null) ?? null,
        userId: asNullableBigInt(stored.user_id),
        username: (stored.username as string | null) ?? null,
        modelName: (stored.model_name as string | null) ?? null,
        channelId: asNullableBigInt(stored.channel_id),
      };
      assertDimensionKeyMatchesStored(dim, storedKey);
      idByHash.set(hex, asBigInt(stored.id));
    }
  }

  return idByHash;
}

function nullableMaxBigintSql(column: string): string {
  // MAX semantics without null propagation: non-null preferred max; both null => null
  return `CASE
    WHEN dashboard_rollups.${column} IS NULL THEN EXCLUDED.${column}
    WHEN EXCLUDED.${column} IS NULL THEN dashboard_rollups.${column}
    WHEN dashboard_rollups.${column} >= EXCLUDED.${column} THEN dashboard_rollups.${column}
    ELSE EXCLUDED.${column}
  END`;
}

function nullableMaxTextSql(column: string): string {
  return `CASE
    WHEN dashboard_rollups.${column} IS NULL OR dashboard_rollups.${column} = '' THEN EXCLUDED.${column}
    WHEN EXCLUDED.${column} IS NULL OR EXCLUDED.${column} = '' THEN dashboard_rollups.${column}
    WHEN dashboard_rollups.${column} >= EXCLUDED.${column} THEN dashboard_rollups.${column}
    ELSE EXCLUDED.${column}
  END`;
}

async function upsertRollupCells(
  client: DbClient,
  version: number,
  cells: PendingDashboardRollupCell[],
  dimensionIdByHash: Map<string, bigint>,
): Promise<void> {
  for (let i = 0; i < cells.length; i += DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE) {
    const chunk = cells.slice(i, i + DASHBOARD_ROLLUP_WRITE_CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const cell of chunk) {
      const hash = cell.dimensionHash;
      if (!hash) {
        throw new Error("rollup cell missing dimensionHash");
      }
      const dimId = dimensionIdByHash.get(hash.toString("hex"));
      if (dimId === undefined) {
        throw new Error("rollup cell dimension id unresolved");
      }
      const m = cell.metrics;
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
      );
      values.push(
        version,
        cell.grain,
        cell.bucketStart,
        decimalString(dimId),
        decimalString(m.requestCount),
        decimalString(m.inputTokens),
        decimalString(m.outputTokens),
        decimalString(m.cacheTokens),
        decimalString(m.attemptCount),
        decimalString(m.successCount),
        decimalString(m.errorCount),
        finiteNumberString(m.firstTokenLatencySum),
        decimalString(m.firstTokenLatencyCount),
        finiteNumberString(m.responseTimeSum),
        decimalString(m.responseTimeCount),
        finiteNumberString(m.outputTokensPerSecSum),
        decimalString(m.outputTokensPerSecCount),
        m.representativeUserId === null ? null : decimalString(m.representativeUserId),
        m.representativeUsername,
        m.representativeChannelName,
        m.firstUsedAt,
        m.latestUsedAt,
      );
    }

    await client.query(
      `INSERT INTO dashboard_rollups (
         version, grain, bucket_start, dimension_id,
         request_count, input_tokens, output_tokens, cache_tokens,
         attempt_count, success_count, error_count,
         first_token_latency_sum, first_token_latency_count,
         response_time_sum, response_time_count,
         output_tokens_per_sec_sum, output_tokens_per_sec_count,
         representative_user_id, representative_username, representative_channel_name,
         first_used_at, latest_used_at
       ) VALUES ${placeholders.join(",")}
       ON CONFLICT (version, grain, bucket_start, dimension_id) DO UPDATE SET
         request_count = dashboard_rollups.request_count + EXCLUDED.request_count,
         input_tokens = dashboard_rollups.input_tokens + EXCLUDED.input_tokens,
         output_tokens = dashboard_rollups.output_tokens + EXCLUDED.output_tokens,
         cache_tokens = dashboard_rollups.cache_tokens + EXCLUDED.cache_tokens,
         attempt_count = dashboard_rollups.attempt_count + EXCLUDED.attempt_count,
         success_count = dashboard_rollups.success_count + EXCLUDED.success_count,
         error_count = dashboard_rollups.error_count + EXCLUDED.error_count,
         first_token_latency_sum = dashboard_rollups.first_token_latency_sum + EXCLUDED.first_token_latency_sum,
         first_token_latency_count = dashboard_rollups.first_token_latency_count + EXCLUDED.first_token_latency_count,
         response_time_sum = dashboard_rollups.response_time_sum + EXCLUDED.response_time_sum,
         response_time_count = dashboard_rollups.response_time_count + EXCLUDED.response_time_count,
         output_tokens_per_sec_sum = dashboard_rollups.output_tokens_per_sec_sum + EXCLUDED.output_tokens_per_sec_sum,
         output_tokens_per_sec_count = dashboard_rollups.output_tokens_per_sec_count + EXCLUDED.output_tokens_per_sec_count,
         representative_user_id = ${nullableMaxBigintSql("representative_user_id")},
         representative_username = ${nullableMaxTextSql("representative_username")},
         representative_channel_name = ${nullableMaxTextSql("representative_channel_name")},
         first_used_at = LEAST(dashboard_rollups.first_used_at, EXCLUDED.first_used_at),
         latest_used_at = GREATEST(dashboard_rollups.latest_used_at, EXCLUDED.latest_used_at)`,
      values,
    );
  }
}

async function reconcileGapLane(
  client: DbClient,
  version: number,
  gapStartId: bigint,
  gapEndId: bigint,
  fetchedIdsAsc: bigint[],
  nowSeconds: number,
): Promise<void> {
  if (fetchedIdsAsc.length === 0) {
    // Load attempts and backoff
    const existing = await client.query(
      `SELECT probe_attempts FROM dashboard_rollup_id_gaps
       WHERE version = $1 AND gap_start_id = $2 AND gap_end_id = $3`,
      [version, decimalString(gapStartId), decimalString(gapEndId)],
    );
    const attempts = asNumber(
      (existing.rows[0] as { probe_attempts?: unknown } | undefined)?.probe_attempts,
      0,
    );
    const nextAttempts = attempts + 1;
    // Use the new attempt count for delay; cap via gapBackoffSeconds.
    const backoff = gapBackoffSeconds(nextAttempts);
    await client.query(
      `UPDATE dashboard_rollup_id_gaps
       SET probe_attempts = $4,
           next_probe_at = $5
       WHERE version = $1 AND gap_start_id = $2 AND gap_end_id = $3`,
      [
        version,
        decimalString(gapStartId),
        decimalString(gapEndId),
        nextAttempts,
        nowSeconds + backoff,
      ],
    );
    return;
  }

  // Delete original interval; re-insert residual uncovered ranges within [gapStart, gapEnd]
  await client.query(
    `DELETE FROM dashboard_rollup_id_gaps
     WHERE version = $1 AND gap_start_id = $2 AND gap_end_id = $3`,
    [version, decimalString(gapStartId), decimalString(gapEndId)],
  );

  const sorted = [...fetchedIdsAsc].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const residuals: IdGapRange[] = [];

  // Before first fetched
  if (sorted[0]! > gapStartId) {
    residuals.push({ start: gapStartId, end: sorted[0]! - BigInt(1) });
  }
  // Between fetched
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1]! > sorted[i]! + BigInt(1)) {
      residuals.push({ start: sorted[i]! + BigInt(1), end: sorted[i + 1]! - BigInt(1) });
    }
  }
  // After last fetched — only if we did not reach end (batch may be limited)
  const last = sorted[sorted.length - 1]!;
  if (last < gapEndId) {
    residuals.push({ start: last + BigInt(1), end: gapEndId });
  }

  await upsertGapRanges(client, version, residuals, nowSeconds);
}

function toSourceRows(rows: Record<string, unknown>[]): DashboardSourceLogRow[] {
  return rows.map((r) => ({
    id: r.id as string | number | bigint,
    created_at: r.created_at as string | number | bigint,
    token_id: (r.token_id as string | number | bigint | null) ?? null,
    token_name: (r.token_name as string | null) ?? null,
    user_id: (r.user_id as string | number | bigint | null) ?? null,
    username: (r.username as string | null) ?? null,
    model_name: (r.model_name as string | null) ?? null,
    channel_id: (r.channel_id as string | number | bigint | null) ?? null,
    channel_name: (r.channel_name as string | null) ?? null,
    prompt_tokens: (r.prompt_tokens as string | number | bigint | null) ?? null,
    completion_tokens: (r.completion_tokens as string | number | bigint | null) ?? null,
    type: (r.type as string | number | bigint | null) ?? null,
    use_time: (r.use_time as string | number | bigint | null) ?? null,
    other: (r.other as string | null) ?? null,
  }));
}

function emptyResult(
  workItem: DashboardRollupWorkItem,
  state: LoadedState | null,
  partial: Partial<DashboardRollupBatchResult> & { durationMs: number },
): DashboardRollupBatchResult {
  return {
    lane: workItem.lane,
    version: workItem.version,
    fetchedRows: 0,
    claimedRows: 0,
    groupedCells: 0,
    liveCursorId: state ? decimalString(state.liveCursorId) : "0",
    historyCursorId: state
      ? state.historyCursorId === null
        ? null
        : decimalString(state.historyCursorId)
      : null,
    historyComplete: state?.historyComplete ?? false,
    lagIdSpan: null,
    malformedOtherRows: 0,
    ...partial,
  };
}

export async function processDashboardRollupWorkItem(
  client: DbClient,
  workItem: DashboardRollupWorkItem,
  config: DashboardRollupConfig,
  nowSeconds: number,
): Promise<DashboardRollupBatchResult> {
  const started = performance.now();

  const lock = await client.query(`SELECT pg_try_advisory_xact_lock($1,$2)`, [
    DASHBOARD_ROLLUP_ADVISORY_LOCK_CLASS,
    DASHBOARD_ROLLUP_ADVISORY_LOCK_OBJECT,
  ]);
  const lockRow = lock.rows[0] as Record<string, unknown> | undefined;
  const lockOk = asBoolean(
    lockRow?.pg_try_advisory_xact_lock ?? lockRow?.["pg_try_advisory_xact_lock"],
  );
  if (!lockOk) {
    return emptyResult(workItem, null, {
      durationMs: Math.max(0, performance.now() - started),
      skippedReason: "lock_unavailable",
    });
  }

  const stateResult = await client.query(
    `SELECT version, source_table_oid, source_boundary_id, live_cursor_id,
            history_cursor_id, history_complete, status,
            processed_rows, malformed_other_rows,
            processed_min_created_at, processed_max_created_at
     FROM dashboard_rollup_state
     WHERE version = $1
     FOR UPDATE`,
    [workItem.version],
  );
  const stateRow = stateResult.rows[0] as VersionStateRow | undefined;
  if (!stateRow) {
    throw new Error(`dashboard rollup state missing for version ${workItem.version}`);
  }
  const state = mapState(stateRow);
  if (state.version !== workItem.version) {
    throw new Error("dashboard rollup version mismatch");
  }

  if (state.status === "inactive") {
    return emptyResult(workItem, state, {
      durationMs: Math.max(0, performance.now() - started),
      skippedReason: "version_inactive",
    });
  }

  async function markUnhealthyAndSkip(message: string): Promise<DashboardRollupBatchResult> {
    await client.query(
      `UPDATE dashboard_rollup_state
       SET status = 'unhealthy',
           last_error = $2,
           updated_at = $3
       WHERE version = $1`,
      [workItem.version, message, nowSeconds],
    );
    return emptyResult(workItem, state, {
      durationMs: Math.max(0, performance.now() - started),
      skippedReason: "source_unhealthy",
      historyComplete: state.historyComplete,
      liveCursorId: decimalString(state.liveCursorId),
      historyCursorId:
        state.historyCursorId === null ? null : decimalString(state.historyCursorId),
    });
  }

  if (state.status === "unhealthy") {
    return emptyResult(workItem, state, {
      durationMs: Math.max(0, performance.now() - started),
      skippedReason: "source_unhealthy",
    });
  }

  const sourceSchema = await inspectDashboardSourceSchema(client);
  if (!sourceSchema.idColumnUsable || !sourceSchema.createdAtColumnUsable || sourceSchema.tableOid === 0) {
    return markUnhealthyAndSkip("Dashboard rollup source schema is not usable");
  }
  if (sourceSchema.tableOid !== state.sourceTableOid) {
    return markUnhealthyAndSkip(
      `dashboard rollup source_table_oid mismatch: recorded ${state.sourceTableOid}, current ${sourceSchema.tableOid}`,
    );
  }

  const latestId = await loadLatestSourceId(client);

  if (latestId === null) {
    if (state.liveCursorId > BigInt(0)) {
      return markUnhealthyAndSkip("source logs empty while live_cursor_id > 0");
    }
  } else if (latestId < state.liveCursorId) {
    return markUnhealthyAndSkip(
      `latest source id is behind live_cursor_id: latest ${latestId.toString()} live ${state.liveCursorId.toString()}`,
    );
  }

  const batchSize = config.batchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error(`invalid batchSize ${batchSize}`);
  }

  // History finalization: cursor already exhausted; complete only when no unprobed gaps.
  if (workItem.lane === "history" && state.historyCursorId === null) {
    const unprobed = await countUnprobedGaps(client, workItem.version);
    let historyComplete = state.historyComplete;
    if (unprobed === 0) {
      historyComplete = true;
      if (!state.historyComplete) {
        await client.query(
          `UPDATE dashboard_rollup_state
           SET history_complete = TRUE,
               history_cursor_id = NULL,
               updated_at = $2
           WHERE version = $1`,
          [workItem.version, nowSeconds],
        );
      }
      state.historyComplete = true;
      await maybeActivateBuildingVersion(
        client,
        workItem.version,
        state,
        state.liveCursorId,
        true,
        nowSeconds,
      );
    }
    return emptyResult(workItem, state, {
      durationMs: Math.max(0, performance.now() - started),
      historyComplete,
      historyCursorId: null,
      liveCursorId: decimalString(state.liveCursorId),
      lagIdSpan:
        latestId === null
          ? "0"
          : decimalString(
              latestId > state.liveCursorId ? latestId - state.liveCursorId : BigInt(0),
            ),
    });
  }

  let sourceQuery: DashboardSqlQuery;
  if (workItem.lane === "live") {
    sourceQuery = buildLiveSourceQuery(state.liveCursorId, batchSize);
  } else if (workItem.lane === "history") {
    sourceQuery = buildHistorySourceQuery(
      state.historyCursorId!,
      state.sourceBoundaryId,
      batchSize,
    );
  } else {
    sourceQuery = buildGapSourceQuery(workItem.gapStartId, workItem.gapEndId, batchSize);
  }

  const sourceResult = await client.query(sourceQuery.text, sourceQuery.values);
  const sourceRows = toSourceRows(sourceResult.rows as Record<string, unknown>[]);
  const fetchedRows = sourceRows.length;

  const fetchedIds = sourceRows.map((r) => asBigInt(r.id));
  // Preserve lane order for gap detection
  if (workItem.lane === "live") {
    const gaps = detectLiveGaps(state.liveCursorId, fetchedIds);
    await upsertGapRanges(client, workItem.version, gaps, nowSeconds);
  } else if (workItem.lane === "history") {
    // Pass exclusive prior cursor (including empty fetch) so leading/terminal gaps are recorded
    // before countUnprobedGaps decides historyComplete.
    const gaps = detectHistoryGaps(fetchedIds, state.historyCursorId);
    await upsertGapRanges(client, workItem.version, gaps, nowSeconds);
  }

  // Claim all fetched IDs (including already-processed conflicts)
  const claimedIds = await claimSourceIds(client, workItem.version, fetchedIds, nowSeconds);
  const claimedSet = new Set(claimedIds.map((id) => id.toString()));
  const claimedRows = sourceRows.filter((r) => claimedSet.has(asBigInt(r.id).toString()));

  let groupedCells = 0;
  let batchMalformed = 0;

  if (claimedRows.length > 0) {
    const formula = getDashboardRollupFormula(workItem.version);
    const normalized = claimedRows.map((row) => formula.normalize(row));
    const accumulated = accumulateNormalizedDashboardRows(normalized);
    batchMalformed = accumulated.malformedOtherRows;
    groupedCells = accumulated.cells.length;

    const dimensionIdByHash = await resolveDimensions(
      client,
      workItem.version,
      accumulated.dimensions,
    );
    await upsertRollupCells(client, workItem.version, accumulated.cells, dimensionIdByHash);

    // Update processed min/max from claimed only
    for (const n of normalized) {
      if (state.processedMinCreatedAt === null || n.createdAt < state.processedMinCreatedAt) {
        state.processedMinCreatedAt = n.createdAt;
      }
      if (state.processedMaxCreatedAt === null || n.createdAt > state.processedMaxCreatedAt) {
        state.processedMaxCreatedAt = n.createdAt;
      }
    }
    state.processedRows += BigInt(claimedIds.length);
    state.malformedOtherRows += BigInt(batchMalformed);
  }

  // Gap lane reconciliation after claims
  if (workItem.lane === "gap") {
    const idsAsc = [...fetchedIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    await reconcileGapLane(
      client,
      workItem.version,
      workItem.gapStartId,
      workItem.gapEndId,
      idsAsc,
      nowSeconds,
    );
  }

  // Cursor updates — advance even when all claims conflicted
  let liveCursorId = state.liveCursorId;
  let historyCursorId = state.historyCursorId;
  let historyComplete = state.historyComplete;

  if (workItem.lane === "live") {
    if (fetchedIds.length > 0) {
      let maxId = fetchedIds[0]!;
      for (const id of fetchedIds) {
        if (id > maxId) maxId = id;
      }
      liveCursorId = maxId;
    }
  } else if (workItem.lane === "history") {
    if (fetchedIds.length === 0) {
      historyCursorId = null;
      // Only complete when every recorded gap has been probed at least once.
      const unprobed = await countUnprobedGaps(client, workItem.version);
      historyComplete = unprobed === 0;
    } else {
      let minId = fetchedIds[0]!;
      for (const id of fetchedIds) {
        if (id < minId) minId = id;
      }
      historyCursorId = minId;
    }
  }

  state.liveCursorId = liveCursorId;
  state.historyCursorId = historyCursorId;
  state.historyComplete = historyComplete;

  const lagIdSpan =
    latestId === null
      ? "0"
      : decimalString(latestId > liveCursorId ? latestId - liveCursorId : BigInt(0));

  await client.query(
    `UPDATE dashboard_rollup_state
     SET live_cursor_id = $2,
         history_cursor_id = $3,
         history_complete = $4,
         processed_rows = $5,
         malformed_other_rows = $6,
         processed_min_created_at = $7,
         processed_max_created_at = $8,
         updated_at = $9
     WHERE version = $1`,
    [
      workItem.version,
      decimalString(liveCursorId),
      historyCursorId === null ? null : decimalString(historyCursorId),
      historyComplete,
      decimalString(state.processedRows),
      decimalString(state.malformedOtherRows),
      state.processedMinCreatedAt,
      state.processedMaxCreatedAt,
      nowSeconds,
    ],
  );

  await maybeActivateBuildingVersion(
    client,
    workItem.version,
    state,
    liveCursorId,
    historyComplete,
    nowSeconds,
  );

  return {
    lane: workItem.lane,
    version: workItem.version,
    fetchedRows,
    claimedRows: claimedIds.length,
    groupedCells,
    durationMs: Math.max(0, performance.now() - started),
    liveCursorId: decimalString(liveCursorId),
    historyCursorId: historyCursorId === null ? null : decimalString(historyCursorId),
    historyComplete,
    lagIdSpan,
    malformedOtherRows: batchMalformed,
  };
}

async function maybeActivateBuildingVersion(
  client: DbClient,
  version: number,
  state: LoadedState,
  liveCursorId: bigint,
  historyComplete: boolean,
  nowSeconds: number,
): Promise<void> {
  if (state.status !== "building" || !historyComplete) return;

  // Unprobed gaps must not activate.
  const unprobed = await countUnprobedGaps(client, version);
  if (unprobed > 0) return;

  const freshLatestId = (await loadLatestSourceId(client)) ?? BigInt(0);
  if (freshLatestId > liveCursorId) return;

  // Atomically demote previous active and switch registry under registry row lock.
  const reg = await client.query(
    `SELECT active_version, building_version
     FROM dashboard_rollup_registry
     WHERE singleton = TRUE
     FOR UPDATE`,
  );
  const regRow = reg.rows[0] as
    | { active_version: number | null; building_version: number | null }
    | undefined;
  if (!regRow) {
    throw new Error("dashboard_rollup_registry singleton row is missing");
  }

  const previousActive =
    regRow.active_version === null || regRow.active_version === undefined
      ? null
      : asNumber(regRow.active_version);

  if (previousActive !== null && previousActive !== version) {
    await client.query(
      `UPDATE dashboard_rollup_state
       SET status = 'inactive',
           updated_at = $2
       WHERE version = $1 AND status = 'active'`,
      [previousActive, nowSeconds],
    );
  }

  await client.query(
    `UPDATE dashboard_rollup_registry
     SET active_version = $1,
         building_version = NULL,
         updated_at = $2
     WHERE singleton = TRUE`,
    [version, nowSeconds],
  );
  await client.query(
    `UPDATE dashboard_rollup_state
     SET status = 'active',
         updated_at = $2
     WHERE version = $1`,
    [version, nowSeconds],
  );
  state.status = "active";
}
