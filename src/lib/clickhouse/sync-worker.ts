import { withClient as withPgClient } from "../db.ts";
import { normalizeDashboardSourceRow } from "../dashboard/rollup-normalizer.ts";
import type { DashboardSourceLogRow, NormalizedDashboardLog } from "../dashboard/types.ts";

import { getClickHouseClient } from "./client.ts";
import { getClickHouseConfig } from "./config.ts";
import { ensureClickHouseSchema } from "./schema.ts";

const SOURCE_SQL = `SELECT id, created_at, token_id, token_name, user_id, username, model_name,
  channel_id, channel_name, prompt_tokens, completion_tokens, type, use_time, other
  FROM logs WHERE id > $1 ORDER BY id ASC LIMIT $2`;
const SYNC_LOCK_CLASS = 884423;
const SYNC_LOCK_OBJECT = 1;

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
    }
    if (row.responseTime !== null) {
      cell.response_time_sum += row.responseTime;
      cell.response_time_count = (BigInt(cell.response_time_count) + BigInt(1)).toString();
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
      if (source.rows.length === 0) return 0;
      const cells = aggregateSyncBatch(source.rows, BigInt(cursor + 1));
      await client.insert({ table: "dashboard_minute_batches", values: cells, format: "JSONEachRow" });
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
      return source.rows.length;
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
