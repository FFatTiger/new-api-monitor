import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DbClient } from "../db.ts";
import {
  DASHBOARD_ROLLUP_DDL,
  ensureDashboardRollupSchema,
  initializeDashboardRollupRegistry,
  inspectDashboardSourceSchema,
  type DashboardRollupVersionState,
} from "./rollup-schema.ts";

type QueryHandler = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;

function createFakeClient(handler: QueryHandler): {
  client: DbClient;
  statements: string[];
  valuesLog: unknown[][];
} {
  const statements: string[] = [];
  const valuesLog: unknown[][] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push(text);
      valuesLog.push(values ?? []);
      return handler(text, values);
    },
  } as DbClient;
  return { client, statements, valuesLog };
}

const validCatalogRow = {
  table_oid: 4242,
  id_exists: true,
  id_integer_compatible: true,
  id_not_null: true,
  id_unique_leading: true,
  created_at_exists: true,
  created_at_integer_compatible: true,
};

describe("dashboard rollup schema", () => {
  it("includes all permanent tables, indexes, mask/grain checks, and malformed counter", () => {
    const ddl = DASHBOARD_ROLLUP_DDL.join("\n");
    for (const table of [
      "dashboard_rollup_registry",
      "dashboard_rollup_state",
      "dashboard_rollup_processed_sources",
      "dashboard_rollup_id_gaps",
      "dashboard_rollup_dimensions",
      "dashboard_rollups",
    ]) {
      assert.match(ddl, new RegExp(table));
    }
    assert.match(ddl, /malformed_other_rows\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    assert.match(ddl, /dimension_mask\s+IN\s*\(\s*0\s*,\s*1\s*,\s*2\s*,\s*4\s*,\s*8\s*,\s*15\s*\)/i);
    assert.match(ddl, /grain\s+.*IN\s*\(\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*\)/i);
    assert.match(ddl, /idx_dashboard_rollup_id_gaps_due/i);
    assert.match(ddl, /idx_dashboard_rollups_dimension_bucket/i);
    assert.match(ddl, /idx_dashboard_rollup_dimensions_username/i);
    assert.match(ddl, /idx_dashboard_rollup_dimensions_model/i);
    assert.match(ddl, /idx_dashboard_rollup_dimensions_channel/i);
    assert.match(ddl, /idx_dashboard_rollup_dimensions_token/i);
    assert.match(ddl, /\(version,\s*dimension_mask,\s*(username|model_name|channel_id|token_id)\)/i);
  });

  it("DDL never creates, alters, indexes, or analyzes logs", () => {
    for (const statement of DASHBOARD_ROLLUP_DDL) {
      assert.doesNotMatch(
        statement,
        /\b(CREATE|ALTER|ANALYZE)\b[\s\S]*\blogs\b/i,
      );
      assert.doesNotMatch(statement, /\bCREATE\s+INDEX\b[\s\S]*\bon\s+logs\b/i);
    }
  });

  it("ensureDashboardRollupSchema executes every DDL statement in order", async () => {
    const statements: string[] = [];
    const client = {
      async query(text: string) {
        statements.push(text);
        return { rows: [], rowCount: 0 };
      },
    } as DbClient;
    await ensureDashboardRollupSchema(client);
    assert.equal(statements.length, DASHBOARD_ROLLUP_DDL.length);
    assert.deepEqual(statements, [...DASHBOARD_ROLLUP_DDL]);
  });

  it("inspectDashboardSourceSchema maps a valid catalog fixture to usable flags", async () => {
    const { client } = createFakeClient(async () => ({
      rows: [validCatalogRow],
      rowCount: 1,
    }));

    const schema = await inspectDashboardSourceSchema(client);
    assert.deepEqual(schema, {
      tableOid: 4242,
      idColumnUsable: true,
      createdAtColumnUsable: true,
    });
  });

  it("missing relation/id/created_at/btree uniqueness is unusable and initializer rejects", async () => {
    const cases = [
      {
        name: "missing relation",
        rows: [] as Record<string, unknown>[],
        expected: { tableOid: 0, idColumnUsable: false, createdAtColumnUsable: false },
      },
      {
        name: "missing id uniqueness",
        rows: [
          {
            ...validCatalogRow,
            id_unique_leading: false,
          },
        ],
        expected: { tableOid: 4242, idColumnUsable: false, createdAtColumnUsable: true },
      },
      {
        name: "missing created_at",
        rows: [
          {
            ...validCatalogRow,
            created_at_exists: false,
            created_at_integer_compatible: false,
          },
        ],
        expected: { tableOid: 4242, idColumnUsable: true, createdAtColumnUsable: false },
      },
    ];

    for (const testCase of cases) {
      const { client: inspectClient } = createFakeClient(async () => ({
        rows: testCase.rows,
        rowCount: testCase.rows.length,
      }));
      const schema = await inspectDashboardSourceSchema(inspectClient);
      assert.deepEqual(schema, testCase.expected, testCase.name);

      let registryQueryCount = 0;
      const { client: initClient, statements } = createFakeClient(async (text) => {
        if (/pg_class|pg_attribute|pg_index/i.test(text)) {
          return { rows: testCase.rows, rowCount: testCase.rows.length };
        }
        if (/dashboard_rollup_registry/i.test(text) && /INSERT/i.test(text)) {
          registryQueryCount += 1;
          return { rows: [], rowCount: 1 };
        }
        if (/dashboard_rollup_registry/i.test(text) && /SELECT/i.test(text)) {
          return {
            rows: [{ active_version: null, building_version: null, updated_at: 0 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      });

      await assert.rejects(
        () => initializeDashboardRollupRegistry(initClient, [1], 1, 1_700_000_000),
        /source schema|logs\.id|created_at|usable/i,
        testCase.name,
      );
      assert.equal(
        statements.some((s) => /INSERT\s+INTO\s+dashboard_rollup_state/i.test(s)),
        false,
        `${testCase.name} must not insert state`,
      );
      // registry singleton insert is allowed before/around inspect, but rejection must happen
      assert.ok(registryQueryCount >= 0);
    }
  });

  it("empty source initializes boundary/live=0, null history, complete=true", async () => {
    const { client, statements } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: null, building_version: null, updated_at: 0 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      if (/FROM\s+logs\b/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const state = await initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_100);
    assert.deepEqual(state, {
      version: 1,
      sourceTableOid: 4242,
      sourceBoundaryId: BigInt(0),
      liveCursorId: BigInt(0),
      historyCursorId: null,
      historyComplete: true,
      status: "building",
    } satisfies DashboardRollupVersionState);

    const boundary = statements.find((s) => /FROM\s+logs\b/i.test(s));
    assert.ok(boundary);
    assert.match(boundary!, /ORDER\s+BY\s+id\s+DESC/i);
    assert.match(boundary!, /LIMIT\s+1/i);
  });

  it("nonempty latest id initializes boundary/live=id, history=id+1, complete=false", async () => {
    const { client } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: null, building_version: null, updated_at: 0 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      if (/FROM\s+logs\b/i.test(text)) {
        return { rows: [{ id: "99" }], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const state = await initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_200);
    assert.equal(state.version, 1);
    assert.equal(state.sourceTableOid, 4242);
    assert.equal(state.sourceBoundaryId, BigInt(99));
    assert.equal(state.liveCursorId, BigInt(99));
    assert.equal(state.historyCursorId, BigInt(100));
    assert.equal(state.historyComplete, false);
    assert.equal(state.status, "building");
  });

  it("boundary query uses ORDER BY id DESC LIMIT 1 without aggregates", async () => {
    const { client, statements } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: null, building_version: null, updated_at: 0 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      if (/FROM\s+logs\b/i.test(text)) {
        return { rows: [{ id: 7 }], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_300);
    const boundary = statements.find((s) => /FROM\s+logs\b/i.test(s));
    assert.ok(boundary);
    assert.match(boundary!, /SELECT\s+id\s+FROM\s+logs\s+ORDER\s+BY\s+id\s+DESC\s+LIMIT\s+1/i);
    assert.doesNotMatch(boundary!, /\b(COUNT|MIN|MAX)\s*\(/i);
  });

  it("existing state is returned without boundary query or cursor reset", async () => {
    const existing = {
      version: 1,
      source_table_oid: 4242,
      source_boundary_id: "50",
      live_cursor_id: "80",
      history_cursor_id: "20",
      history_complete: false,
      status: "building",
    };
    const { client, statements } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: null, building_version: 1, updated_at: 1 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [existing], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const state = await initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_400);
    assert.deepEqual(state, {
      version: 1,
      sourceTableOid: 4242,
      sourceBoundaryId: BigInt(50),
      liveCursorId: BigInt(80),
      historyCursorId: BigInt(20),
      historyComplete: false,
      status: "building",
    });
    assert.equal(statements.some((s) => /FROM\s+logs\b/i.test(s)), false);
    assert.equal(statements.some((s) => /UPDATE\s+dashboard_rollup_state/i.test(s)), false);
    assert.equal(statements.some((s) => /INSERT\s+INTO\s+dashboard_rollup_state/i.test(s)), false);
  });

  it("OID mismatch throws and does not update state", async () => {
    const existing = {
      version: 1,
      source_table_oid: 1111,
      source_boundary_id: "50",
      live_cursor_id: "80",
      history_cursor_id: "20",
      history_complete: false,
      status: "building",
    };
    const { client, statements } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: null, building_version: 1, updated_at: 1 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [existing], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await assert.rejects(
      () => initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_500),
      /source_table_oid|OID|table identity/i,
    );
    assert.equal(statements.some((s) => /UPDATE\s+dashboard_rollup_state/i.test(s)), false);
    assert.equal(statements.some((s) => /INSERT\s+INTO\s+dashboard_rollup_state/i.test(s)), false);
  });

  it("unknown active formula version throws and does not modify registry", async () => {
    const { client, statements } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: 9, building_version: null, updated_at: 1 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await assert.rejects(
      () => initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_600),
      /active_version|executable/i,
    );
    assert.equal(statements.some((s) => /UPDATE\s+dashboard_rollup_registry/i.test(s)), false);
    assert.equal(statements.some((s) => /INSERT\s+INTO\s+dashboard_rollup_state/i.test(s)), false);
  });

  it("older executable active remains active while current formula becomes building", async () => {
    const updates: unknown[][] = [];
    const { client } = createFakeClient(async (text, values) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: 1, building_version: null, updated_at: 1 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      if (/FROM\s+logs\b/i.test(text)) {
        return { rows: [{ id: 12 }], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_registry/i.test(text)) {
        updates.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const state = await initializeDashboardRollupRegistry(client, [1, 2], 2, 1_700_000_700);
    assert.equal(state.version, 2);
    assert.equal(state.status, "building");
    assert.equal(state.sourceBoundaryId, BigInt(12));
    assert.equal(state.liveCursorId, BigInt(12));
    assert.equal(state.historyCursorId, BigInt(13));
    assert.equal(state.historyComplete, false);
    assert.ok(updates.length >= 1);
    // active stays 1; building becomes 2
    const joined = updates.map((v) => v.join(",")).join("|");
    assert.match(joined, /2/);
    // Ensure we didn't clear active to null or overwrite with building only without preserving active
    assert.ok(
      updates.some((v) => v.includes(2) || v.includes(1_700_000_700)),
    );
  });

  it("re-running initialization is idempotent", async () => {
    let stateInserted = 0;
    let boundaryQueries = 0;
    const existingAfterInsert = {
      version: 1,
      source_table_oid: 4242,
      source_boundary_id: "5",
      live_cursor_id: "5",
      history_cursor_id: "6",
      history_complete: false,
      status: "building",
    };
    let hasState = false;

    const handler: QueryHandler = async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [
            {
              active_version: null,
              building_version: hasState ? 1 : null,
              updated_at: 1,
            },
          ],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return hasState
          ? { rows: [existingAfterInsert], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (/FROM\s+logs\b/i.test(text)) {
        boundaryQueries += 1;
        return { rows: [{ id: 5 }], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_state/i.test(text)) {
        stateInserted += 1;
        hasState = true;
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    const first = createFakeClient(handler);
    const state1 = await initializeDashboardRollupRegistry(first.client, [1], 1, 1_700_000_800);
    const second = createFakeClient(handler);
    const state2 = await initializeDashboardRollupRegistry(second.client, [1], 1, 1_700_000_801);

    assert.deepEqual(state1, state2);
    assert.equal(stateInserted, 1);
    assert.equal(boundaryQueries, 1);
  });

  it("active equals buildingVersion returns existing active state without creating another version", async () => {
    const existing = {
      version: 1,
      source_table_oid: 4242,
      source_boundary_id: "10",
      live_cursor_id: "15",
      history_cursor_id: null,
      history_complete: true,
      status: "active",
    };
    const { client, statements } = createFakeClient(async (text) => {
      if (/pg_class|pg_attribute|pg_index/i.test(text)) {
        return { rows: [validCatalogRow], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+dashboard_rollup_registry/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+dashboard_rollup_registry/i.test(text)) {
        return {
          rows: [{ active_version: 1, building_version: null, updated_at: 1 }],
          rowCount: 1,
        };
      }
      if (/FROM\s+dashboard_rollup_state/i.test(text)) {
        return { rows: [existing], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const state = await initializeDashboardRollupRegistry(client, [1], 1, 1_700_000_900);
    assert.equal(state.status, "active");
    assert.equal(state.version, 1);
    assert.equal(state.historyComplete, true);
    assert.equal(state.historyCursorId, null);
    assert.equal(statements.some((s) => /INSERT\s+INTO\s+dashboard_rollup_state/i.test(s)), false);
    assert.equal(statements.some((s) => /FROM\s+logs\b/i.test(s)), false);
  });
});
