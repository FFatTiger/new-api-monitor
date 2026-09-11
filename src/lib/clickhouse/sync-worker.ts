import { withClient as withPgClient } from "../db.ts";
import { normalizeDashboardSourceRow } from "../dashboard/rollup-normalizer.ts";
import type { DashboardSourceLogRow, NormalizedDashboardLog } from "../dashboard/types.ts";

import { getClickHouseClient } from "./client.ts";
import { getClickHouseConfig } from "./config.ts";
import {
  FRT_BUCKET_BOUNDS_MS,
  HISTOGRAM_BUCKET_COUNT,
  RESPONSE_BUCKET_BOUNDS_SECONDS,
  ensureClickHouseSchema,
  histogramBucketColumn,
} from "./schema.ts";

const SOURCE_SQL = `SELECT id, created_at, token_id, token_name, user_id, username, model_name,
  channel_id, channel_name, prompt_tokens, completion_tokens, type, use_time, other
  FROM logs WHERE id > $1 ORDER BY id ASC LIMIT $2`;
/** Error rows are sparse; its own cursor keeps classification independent of the main sync. */
const ERROR_SOURCE_SQL = `SELECT id, created_at, token_id, token_name, user_id, username, model_name, channel_id, channel_name, other
  FROM logs WHERE id > $1 AND type = 5 ORDER BY id ASC LIMIT $2`;
const SYNC_LOCK_CLASS = 884423;
const SYNC_LOCK_OBJECT = 1;

/** Bucket index for a value against ascending bounds; the last bucket is open-ended. */
export function histogramBucketIndex(value: number, bounds: readonly number[]): number {
  for (let index = 0; index < bounds.length; index += 1) {
    if (value < bounds[index]!) return index;
  }
  return bounds.length;
}

interface BatchCell {
  batch_id: string;
  version: string;
  bucket_start: number;
  token_id: string;
  token_name: string;
  user_id: string;
  username: string;
  model_name: string;
  channel_id: string;
  channel_name: string;
  request_count: string;
  input_tokens: string;
  output_tokens: string;
  cache_tokens: string;
  attempt_count: string;
  success_count: string;
  error_count: string;
  first_token_latency_sum: number;
  first_token_latency_count: string;
  response_time_sum: number;
  response_time_count: string;
  output_speed_sum: number;
  output_speed_count: string;
  first_used_at: number;
  latest_used_at: number;
  frtBuckets: number[];
  responseBuckets: number[];
}

/** Spreads the histogram arrays onto the scalar bucket columns ClickHouse stores. */
export function toMinuteBatchInsertRow(cell: BatchCell): Record<string, unknown> {
  const { frtBuckets, responseBuckets, ...rest } = cell;
  const row: Record<string, unknown> = { ...rest };
  frtBuckets.forEach((count, index) => {
    row[histogramBucketColumn("frt", index)] = count;
  });
  responseBuckets.forEach((count, index) => {
    row[histogramBucketColumn("response", index)] = count;
  });
  return row;
}

export interface ErrorSourceLogRow {
  id: string | number;
  created_at: string | number;
  token_id: string | number | null;
  token_name: string | null;
  user_id: string | number | null;
  username: string | null;
  model_name: string | null;
  channel_id: string | number | null;
  channel_name: string | null;
  other: string | null;
}

interface ErrorCell {
  batch_id: string;
  version: string;
  bucket_start: number;
  error_type: string;
  status_code: number;
  token_id: string;
  token_name: string;
  user_id: string;
  username: string;
  model_name: string;
  channel_id: string;
  channel_name: string;
  error_count: string;
  latest_used_at: number;
}

const UNKNOWN_ERROR_TYPE = "unknown_error";

/** Extracts the upstream classifier new-api writes into `other` for type=5 rows. */
export function parseErrorClassifier(other: string | null | undefined): { errorType: string; statusCode: number } {
  if (typeof other !== "string" || !other.startsWith("{")) {
    return { errorType: UNKNOWN_ERROR_TYPE, statusCode: 0 };
  }

  try {
    const parsed = JSON.parse(other) as Record<string, unknown>;
    const rawType = parsed.error_type ?? parsed.errorType;
    const errorType =
      typeof rawType === "string" && rawType.trim() ? rawType.trim() : UNKNOWN_ERROR_TYPE;
    const rawStatus = Number(parsed.status_code ?? parsed.statusCode);
    const statusCode = Number.isInteger(rawStatus) && rawStatus >= 0 && rawStatus <= 65_535 ? rawStatus : 0;
    return { errorType, statusCode };
  } catch {
    return { errorType: UNKNOWN_ERROR_TYPE, statusCode: 0 };
  }
}

function key(row: NormalizedDashboardLog): string {
  return [
    Math.floor(row.createdAt / 60) * 60,
    row.tokenId ?? BigInt(0),
    row.tokenName ?? "",
    row.userId ?? BigInt(0),
    row.username ?? "",
    row.modelName,
    row.channelId ?? BigInt(0),
  ].join("\u001f");
}

export function aggregateSyncBatch(rows: DashboardSourceLogRow[], batchIdOverride?: bigint): BatchCell[] {
  if (rows.length === 0) return [];
  const normalized = rows.map(normalizeDashboardSourceRow);
  const batchId = batchIdOverride ?? normalized[0]!.sourceId;
  const version = normalized.at(-1)!.sourceId;
  const cells = new Map<string, BatchCell>();

  for (const row of normalized) {
    const k = key(row);
    let cell = cells.get(k);
    if (!cell) {
      cell = {
        batch_id: batchId.toString(), version: version.toString(),
        bucket_start: Math.floor(row.createdAt / 60) * 60,
        token_id: (row.tokenId ?? BigInt(0)).toString(), token_name: row.tokenName ?? "",
        user_id: (row.userId ?? BigInt(0)).toString(), username: row.username ?? "",
        model_name: row.modelName, channel_id: (row.channelId ?? BigInt(0)).toString(),
        channel_name: row.channelName ?? "", request_count: "0", input_tokens: "0",
        output_tokens: "0", cache_tokens: "0", attempt_count: "0", success_count: "0",
        error_count: "0", first_token_latency_sum: 0, first_token_latency_count: "0",
        response_time_sum: 0, response_time_count: "0", output_speed_sum: 0,
        output_speed_count: "0", first_used_at: row.createdAt, latest_used_at: row.createdAt,
        frtBuckets: Array.from({ length: HISTOGRAM_BUCKET_COUNT }, () => 0),
        responseBuckets: Array.from({ length: HISTOGRAM_BUCKET_COUNT }, () => 0),
      };
      cells.set(k, cell);
    }
    cell.request_count = (BigInt(cell.request_count) + row.requestCount).toString();
    cell.input_tokens = (BigInt(cell.input_tokens) + row.inputTokens).toString();
    cell.output_tokens = (BigInt(cell.output_tokens) + row.outputTokens).toString();
    cell.cache_tokens = (BigInt(cell.cache_tokens) + row.cacheTokens).toString();
    cell.attempt_count = (BigInt(cell.attempt_count) + row.attemptCount).toString();
    cell.success_count = (BigInt(cell.success_count) + row.successCount).toString();
    cell.error_count = (BigInt(cell.error_count) + row.errorCount).toString();
    if (row.firstTokenLatency !== null) {
      cell.first_token_latency_sum += row.firstTokenLatency;
      cell.first_token_latency_count = (BigInt(cell.first_token_latency_count) + BigInt(1)).toString();
      cell.frtBuckets[histogramBucketIndex(row.firstTokenLatency, FRT_BUCKET_BOUNDS_MS)]! += 1;
    }
    if (row.responseTime !== null) {
      cell.response_time_sum += row.responseTime;
      cell.response_time_count = (BigInt(cell.response_time_count) + BigInt(1)).toString();
      cell.responseBuckets[histogramBucketIndex(row.responseTime, RESPONSE_BUCKET_BOUNDS_SECONDS)]! += 1;
    }
    if (row.outputTokensPerSec !== null) {
      cell.output_speed_sum += row.outputTokensPerSec;
      cell.output_speed_count = (BigInt(cell.output_speed_count) + BigInt(1)).toString();
    }
    cell.first_used_at = Math.min(cell.first_used_at, row.createdAt);
    cell.latest_used_at = Math.max(cell.latest_used_at, row.createdAt);
    const channelName = row.channelName ?? "";
    if (channelName > cell.channel_name) cell.channel_name = channelName;
  }
  return [...cells.values()];
}

interface SyncState {
  lastSourceId: number;
  minCreatedAt: number | null;
  maxCreatedAt: number | null;
}

function parseTimestamp(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Aggregates error rows into classification cells.
 *
 * Counts are deliberately NOT a substitute for the main table's error_count:
 * that table answers "how many failures", this one answers "which failures".
 */
export function aggregateErrorBatch(rows: ErrorSourceLogRow[], batchIdOverride?: bigint): ErrorCell[] {
  if (rows.length === 0) return [];

  const parsed = rows.map((row) => ({
    id: BigInt(String(row.id)),
    createdAt: parseTimestamp(row.created_at) ?? 0,
    tokenId: row.token_id === null || row.token_id === undefined ? "0" : String(row.token_id),
    tokenName: row.token_name ?? "",
    userId: row.user_id === null || row.user_id === undefined ? "0" : String(row.user_id),
    username: row.username ?? "",
    modelName: row.model_name ?? "",
    channelId: row.channel_id === null || row.channel_id === undefined ? "0" : String(row.channel_id),
    channelName: row.channel_name ?? "",
    ...parseErrorClassifier(row.other),
  }));

  const batchId = (batchIdOverride ?? parsed[0]!.id).toString();
  const version = parsed.at(-1)!.id.toString();
  const cells = new Map<string, ErrorCell>();

  for (const row of parsed) {
    const bucketStart = Math.floor(row.createdAt / 60) * 60;
    const k = [
      bucketStart,
      row.errorType,
      row.statusCode,
      row.modelName,
      row.channelId,
      row.userId,
      row.tokenId,
      row.tokenName,
      row.username,
    ].join("\u001f");
    let cell = cells.get(k);
    if (!cell) {
      cell = {
        batch_id: batchId,
        version,
        bucket_start: bucketStart,
        error_type: row.errorType,
        status_code: row.statusCode,
        token_id: row.tokenId,
        token_name: row.tokenName,
        user_id: row.userId,
        username: row.username,
        model_name: row.modelName,
        channel_id: row.channelId,
        channel_name: row.channelName,
        error_count: "0",
        latest_used_at: row.createdAt,
      };
      cells.set(k, cell);
    }
    cell.error_count = (BigInt(cell.error_count) + BigInt(1)).toString();
    cell.latest_used_at = Math.max(cell.latest_used_at, row.createdAt);
    if (row.channelName > cell.channel_name) cell.channel_name = row.channelName;
  }

  return [...cells.values()];
}

async function readErrorCursor(): Promise<number> {
  const result = await getClickHouseClient().query({
    query: "SELECT argMax(last_source_id, version) AS id FROM dashboard_error_sync_state WHERE singleton = 1",
    format: "JSONEachRow",
  });
  const rows = await result.json<{ id?: string }>();
  return Number(rows[0]?.id ?? 0);
}

/** Drains one batch of classifiable history; advances its own watermark only. */
export async function runClickHouseErrorSyncBatch(
  limit: number,
  ceiling: number,
  cursor: number,
): Promise<number> {
  return withPgClient(async (pgClient) => {
    const client = getClickHouseClient();
    const source = await pgClient.query<ErrorSourceLogRow>(ERROR_SOURCE_SQL, [String(cursor), limit]);
    // Nothing matched below the main cursor: jump the watermark there so an
    // idle worker stops rescanning the tail on every tick.
    const watermark =
      source.rows.length === 0
        ? Math.max(ceiling, cursor)
        : Number(source.rows[source.rows.length - 1]!.id);

    if (source.rows.length > 0) {
      const cells = aggregateErrorBatch(source.rows, BigInt(cursor + 1));
      await client.insert({ table: "dashboard_error_batches", values: cells, format: "JSONEachRow" });
    }

    if (watermark > cursor) {
      await client.insert({
        table: "dashboard_error_sync_state",
        values: [{ singleton: 1, last_source_id: String(watermark), version: String(watermark) }],
        format: "JSONEachRow",
      });
    }

    return source.rows.length;
  });
}

async function readSyncState(): Promise<SyncState> {
  const result = await getClickHouseClient().query({
    query: `SELECT
      argMax(last_source_id, version) AS id,
      argMax(synced_min_created_at, version) AS min_created_at,
      argMax(synced_max_created_at, version) AS max_created_at
      FROM dashboard_sync_state WHERE singleton = 1`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    id?: string;
    min_created_at?: string | null;
    max_created_at?: string | null;
  }>();
  const row = rows[0];
  const parseNullable = (value: string | null | undefined): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    lastSourceId: Number(row?.id ?? 0),
    minCreatedAt: parseNullable(row?.min_created_at),
    maxCreatedAt: parseNullable(row?.max_created_at),
  };
}

export async function runClickHouseSyncBatch(): Promise<number> {
  const config = getClickHouseConfig();
  return withPgClient(async (pgClient) => {
    const lockResult = await pgClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [SYNC_LOCK_CLASS, SYNC_LOCK_OBJECT],
    );
    if (!lockResult.rows[0]?.locked) return 0;

    try {
      const client = getClickHouseClient();
      await ensureClickHouseSchema(client);
      const syncState = await readSyncState();
      const cursor = syncState.lastSourceId;
      const source = await pgClient.query<DashboardSourceLogRow>(SOURCE_SQL, [String(cursor), config.syncBatchSize]);

      let processed = 0;
      let highWater = cursor;

      if (source.rows.length > 0) {
        processed = source.rows.length;
        highWater = Number(source.rows[source.rows.length - 1]!.id);
        const cells = aggregateSyncBatch(source.rows, BigInt(cursor + 1));
        await client.insert({
          table: "dashboard_minute_batches",
          values: cells.map(toMinuteBatchInsertRow),
          format: "JSONEachRow",
        });
        const dimensionMap = new Map<string, { kind: string; value: string; label: string; version: string }>();
        for (const cell of cells) {
          const dimensions = [
            { kind: "user", value: cell.username, label: cell.username },
            { kind: "model", value: cell.model_name, label: cell.model_name },
            { kind: "channel", value: cell.channel_id, label: cell.channel_name || `渠道 ${cell.channel_id}` },
          ];
          for (const dimension of dimensions) {
            if (!dimension.value || dimension.value === "0" || dimension.value === "Unknown") continue;
            dimensionMap.set(`${dimension.kind}\u001f${dimension.value}`, { ...dimension, version: cells[0]!.version });
          }
        }
        if (dimensionMap.size > 0) {
          await client.insert({ table: "dashboard_dimensions", values: [...dimensionMap.values()], format: "JSONEachRow" });
        }
        const normalized = source.rows.map(normalizeDashboardSourceRow);
        const last = normalized.at(-1)!;
        const batchMinCreatedAt = Math.min(...normalized.map((r) => r.createdAt));
        const batchMaxCreatedAt = Math.max(...normalized.map((r) => r.createdAt));
        await client.insert({
          table: "dashboard_sync_state",
          values: [{
            singleton: 1,
            last_source_id: last.sourceId.toString(),
            synced_min_created_at:
              syncState.minCreatedAt === null
                ? batchMinCreatedAt
                : Math.min(syncState.minCreatedAt, batchMinCreatedAt),
            synced_max_created_at:
              syncState.maxCreatedAt === null
                ? batchMaxCreatedAt
                : Math.max(syncState.maxCreatedAt, batchMaxCreatedAt),
            version: last.sourceId.toString(),
          }],
          format: "JSONEachRow",
        });
      }

      // Error classification drains independently. Probing only while its
      // watermark lags the main cursor keeps a caught-up worker from rescanning
      // the log tail on every tick.
      const errorCursor = await readErrorCursor();
      if (errorCursor < highWater) {
        processed += await runClickHouseErrorSyncBatch(config.syncBatchSize, highWater, errorCursor);
      }

      return processed;
    } finally {
      try {
        await pgClient.query("SELECT pg_advisory_unlock($1, $2)", [SYNC_LOCK_CLASS, SYNC_LOCK_OBJECT]);
      } catch (error) {
        console.error("[clickhouse-sync] failed to release advisory lock", error);
      }
    }
  });
}

declare global { var __newApiMonitorClickHouseSyncStarted: boolean | undefined; }

export function startClickHouseSyncWorker(): void {
  const config = getClickHouseConfig();
  if (!config.syncEnabled || globalThis.__newApiMonitorClickHouseSyncStarted) return;
  globalThis.__newApiMonitorClickHouseSyncStarted = true;
  const tick = async () => {
    try {
      const count = await runClickHouseSyncBatch();
      setTimeout(tick, count > 0 ? config.syncPauseMs : Math.max(config.syncPauseMs, 5_000));
    } catch (error) {
      console.error("[clickhouse-sync] batch failed", error);
      setTimeout(tick, Math.max(config.syncPauseMs, 5_000));
    }
  };
  setTimeout(tick, 0);
}
