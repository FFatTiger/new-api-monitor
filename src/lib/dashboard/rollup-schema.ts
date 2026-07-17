import type { DbClient } from "../db.ts";

export interface DashboardSourceSchema {
  tableOid: number;
  idColumnUsable: boolean;
  createdAtColumnUsable: boolean;
}

export type DashboardRollupVersionStatus =
  | "building"
  | "active"
  | "inactive"
  | "unhealthy";

export interface DashboardRollupVersionState {
  version: number;
  sourceTableOid: number;
  sourceBoundaryId: bigint;
  liveCursorId: bigint;
  historyCursorId: bigint | null;
  historyComplete: boolean;
  status: DashboardRollupVersionStatus;
}

/**
 * Application-owned permanent rollup objects only.
 * Never create, alter, analyze, or index the upstream `logs` table.
 */
export const DASHBOARD_ROLLUP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS dashboard_rollup_registry (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  active_version INTEGER,
  building_version INTEGER,
  updated_at BIGINT NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS dashboard_rollup_state (
  version INTEGER PRIMARY KEY,
  source_table_oid OID NOT NULL,
  source_boundary_id BIGINT NOT NULL,
  live_cursor_id BIGINT NOT NULL,
  recent_cutoff BIGINT,
  recent_cursor_created_at BIGINT,
  recent_cursor_id BIGINT,
  recent_complete BOOLEAN NOT NULL DEFAULT FALSE,
  history_cursor_id BIGINT,
  history_complete BOOLEAN NOT NULL DEFAULT FALSE,
  processed_min_created_at BIGINT,
  processed_max_created_at BIGINT,
  processed_rows BIGINT NOT NULL DEFAULT 0,
  malformed_other_rows BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  last_error TEXT,
  updated_at BIGINT NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS dashboard_rollup_processed_sources (
  version INTEGER NOT NULL,
  source_id BIGINT NOT NULL,
  processed_at BIGINT NOT NULL,
  PRIMARY KEY (version, source_id)
)`,

  `CREATE TABLE IF NOT EXISTS dashboard_rollup_id_gaps (
  version INTEGER NOT NULL,
  gap_start_id BIGINT NOT NULL,
  gap_end_id BIGINT NOT NULL,
  next_probe_at BIGINT NOT NULL,
  probe_attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version, gap_start_id, gap_end_id),
  CHECK (gap_start_id <= gap_end_id)
)`,

  `CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_id_gaps_due
  ON dashboard_rollup_id_gaps (version, next_probe_at)`,

  `CREATE TABLE IF NOT EXISTS dashboard_rollup_dimensions (
  id BIGSERIAL PRIMARY KEY,
  version INTEGER NOT NULL,
  dimension_mask SMALLINT NOT NULL,
  dimension_hash BYTEA NOT NULL,
  token_id BIGINT,
  token_name TEXT,
  user_id BIGINT,
  username TEXT,
  model_name TEXT,
  channel_id BIGINT,
  UNIQUE (version, dimension_hash),
  CHECK (dimension_mask IN (0, 1, 2, 4, 8, 15))
)`,

  `CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_username
  ON dashboard_rollup_dimensions (version, dimension_mask, username)`,

  `CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_model
  ON dashboard_rollup_dimensions (version, dimension_mask, model_name)`,

  `CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_channel
  ON dashboard_rollup_dimensions (version, dimension_mask, channel_id)`,

  `CREATE INDEX IF NOT EXISTS idx_dashboard_rollup_dimensions_token
  ON dashboard_rollup_dimensions (version, dimension_mask, token_id)`,

  `CREATE TABLE IF NOT EXISTS dashboard_rollups (
  version INTEGER NOT NULL,
  grain SMALLINT NOT NULL,
  bucket_start BIGINT NOT NULL,
  dimension_id BIGINT NOT NULL REFERENCES dashboard_rollup_dimensions(id),
  request_count BIGINT NOT NULL,
  input_tokens BIGINT NOT NULL,
  output_tokens BIGINT NOT NULL,
  cache_tokens BIGINT NOT NULL,
  attempt_count BIGINT NOT NULL,
  success_count BIGINT NOT NULL,
  error_count BIGINT NOT NULL,
  first_token_latency_sum NUMERIC NOT NULL,
  first_token_latency_count BIGINT NOT NULL,
  response_time_sum NUMERIC NOT NULL,
  response_time_count BIGINT NOT NULL,
  output_tokens_per_sec_sum NUMERIC NOT NULL,
  output_tokens_per_sec_count BIGINT NOT NULL,
  representative_user_id BIGINT,
  representative_username TEXT,
  representative_channel_name TEXT,
  first_used_at BIGINT NOT NULL,
  latest_used_at BIGINT NOT NULL,
  PRIMARY KEY (version, grain, bucket_start, dimension_id),
  CHECK (grain IN (1, 2, 3, 4))
)`,

  `CREATE INDEX IF NOT EXISTS idx_dashboard_rollups_dimension_bucket
  ON dashboard_rollups (version, grain, dimension_id, bucket_start)`,
];

export async function ensureDashboardRollupSchema(client: DbClient): Promise<void> {
  for (const statement of DASHBOARD_ROLLUP_DDL) {
    await client.query(statement);
  }
}

const SOURCE_CATALOG_SQL = `
SELECT
  c.oid AS table_oid,
  EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = c.oid
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) AS id_exists,
  EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = c.oid
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND t.typname IN ('int2', 'int4', 'int8')
  ) AS id_integer_compatible,
  EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = c.oid
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attnotnull
  ) AS id_not_null,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = i.indkey[0]
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE i.indrelid = c.oid
      AND i.indisvalid
      AND (i.indisunique OR i.indisprimary)
      AND i.indpred IS NULL
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND am.amname = 'btree'
  ) AS id_unique_leading,
  EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = c.oid
      AND a.attname = 'created_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) AS created_at_exists,
  EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = c.oid
      AND a.attname = 'created_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND t.typname IN ('int2', 'int4', 'int8')
  ) AS created_at_integer_compatible
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'logs'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND pg_catalog.pg_table_is_visible(c.oid)
ORDER BY (n.nspname = 'public') DESC, n.nspname ASC
LIMIT 1
`.trim();

function asBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (typeof value === "bigint") return Number(value);
  return fallback;
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

export async function inspectDashboardSourceSchema(
  client: DbClient,
): Promise<DashboardSourceSchema> {
  const result = await client.query(SOURCE_CATALOG_SQL);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return {
      tableOid: 0,
      idColumnUsable: false,
      createdAtColumnUsable: false,
    };
  }

  const idExists = asBoolean(row.id_exists);
  const idIntegerCompatible = asBoolean(row.id_integer_compatible);
  const idNotNull = asBoolean(row.id_not_null);
  const idUniqueLeading = asBoolean(row.id_unique_leading);
  const createdAtExists = asBoolean(row.created_at_exists);
  const createdAtIntegerCompatible = asBoolean(row.created_at_integer_compatible);

  return {
    tableOid: asNumber(row.table_oid, 0),
    idColumnUsable: idExists && idIntegerCompatible && idNotNull && idUniqueLeading,
    createdAtColumnUsable: createdAtExists && createdAtIntegerCompatible,
  };
}

function assertSourceSchemaUsable(schema: DashboardSourceSchema): void {
  if (!schema.idColumnUsable || !schema.createdAtColumnUsable || schema.tableOid === 0) {
    const problems: string[] = [];
    if (schema.tableOid === 0) problems.push("visible logs relation is missing");
    if (!schema.idColumnUsable) {
      problems.push(
        "logs.id must exist, be integer-compatible (int2/int4/int8), non-null, and the leading column of a valid non-partial unique/primary btree index",
      );
    }
    if (!schema.createdAtColumnUsable) {
      problems.push("logs.created_at must exist and be integer-compatible (int2/int4/int8)");
    }
    throw new Error(`Dashboard rollup source schema is not usable: ${problems.join("; ")}`);
  }
}

interface RegistryRow {
  active_version: number | null;
  building_version: number | null;
  updated_at: number;
}

interface StateRow {
  version: number;
  source_table_oid: number;
  source_boundary_id: string | number | bigint;
  live_cursor_id: string | number | bigint;
  history_cursor_id: string | number | bigint | null;
  history_complete: boolean | string;
  status: string;
}

function mapStateRow(row: StateRow): DashboardRollupVersionState {
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
  };
}

async function ensureRegistrySingleton(client: DbClient, nowSeconds: number): Promise<void> {
  await client.query(
    `INSERT INTO dashboard_rollup_registry (singleton, active_version, building_version, updated_at)
     VALUES (TRUE, NULL, NULL, $1)
     ON CONFLICT (singleton) DO NOTHING`,
    [nowSeconds],
  );
}

async function readRegistry(client: DbClient): Promise<RegistryRow> {
  const result = await client.query(
    `SELECT active_version, building_version, updated_at
     FROM dashboard_rollup_registry
     WHERE singleton = TRUE`,
  );
  const row = result.rows[0] as RegistryRow | undefined;
  if (!row) {
    throw new Error("dashboard_rollup_registry singleton row is missing");
  }
  return row;
}

async function readState(
  client: DbClient,
  version: number,
): Promise<StateRow | null> {
  const result = await client.query(
    `SELECT version, source_table_oid, source_boundary_id, live_cursor_id,
            history_cursor_id, history_complete, status
     FROM dashboard_rollup_state
     WHERE version = $1`,
    [version],
  );
  return (result.rows[0] as StateRow | undefined) ?? null;
}

/**
 * Initialize registry/state for a building formula version.
 * Caller must already have run ensureDashboardRollupSchema inside the same transaction.
 */
export async function initializeDashboardRollupRegistry(
  client: DbClient,
  executableVersions: readonly number[],
  buildingVersion: number,
  nowSeconds: number,
): Promise<DashboardRollupVersionState> {
  await ensureRegistrySingleton(client, nowSeconds);

  const source = await inspectDashboardSourceSchema(client);
  assertSourceSchemaUsable(source);

  const registry = await readRegistry(client);
  if (
    registry.active_version !== null &&
    registry.active_version !== undefined &&
    !executableVersions.includes(asNumber(registry.active_version))
  ) {
    throw new Error(
      `dashboard rollup active_version ${String(registry.active_version)} is not in executableVersions [${executableVersions.join(", ")}]`,
    );
  }

  const existing = await readState(client, buildingVersion);
  if (existing) {
    const mapped = mapStateRow(existing);
    if (mapped.sourceTableOid !== source.tableOid) {
      throw new Error(
        `dashboard rollup source_table_oid mismatch for version ${buildingVersion}: recorded ${mapped.sourceTableOid}, current ${source.tableOid}`,
      );
    }
    return mapped;
  }

  // No state for buildingVersion. If active equals building and no rebuild needed, that case
  // would have returned above once state existed. Here we create building state.
  const boundaryResult = await client.query(
    `SELECT id FROM logs ORDER BY id DESC LIMIT 1`,
  );
  const latest = boundaryResult.rows[0] as { id: string | number | bigint } | undefined;

  let sourceBoundaryId = BigInt(0);
  let liveCursorId = BigInt(0);
  let historyCursorId: bigint | null = null;
  let historyComplete = true;

  if (latest) {
    const latestId = asBigInt(latest.id);
    sourceBoundaryId = latestId;
    liveCursorId = latestId;
    historyCursorId = latestId + BigInt(1);
    historyComplete = false;
  }

  await client.query(
    `INSERT INTO dashboard_rollup_state (
       version,
       source_table_oid,
       source_boundary_id,
       live_cursor_id,
       history_cursor_id,
       history_complete,
       status,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'building', $7)`,
    [
      buildingVersion,
      source.tableOid,
      sourceBoundaryId.toString(),
      liveCursorId.toString(),
      historyCursorId === null ? null : historyCursorId.toString(),
      historyComplete,
      nowSeconds,
    ],
  );

  // Preserve active when present; set building_version to current formula version.
  await client.query(
    `UPDATE dashboard_rollup_registry
     SET building_version = $1,
         updated_at = $2
     WHERE singleton = TRUE`,
    [buildingVersion, nowSeconds],
  );

  return {
    version: buildingVersion,
    sourceTableOid: source.tableOid,
    sourceBoundaryId,
    liveCursorId,
    historyCursorId,
    historyComplete,
    status: "building",
  };
}
