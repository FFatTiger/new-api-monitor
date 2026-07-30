export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  readsEnabled: boolean;
  syncEnabled: boolean;
  syncBatchSize: number;
  syncPauseMs: number;
  queryTimeoutMs: number;
  maxThreads: number;
  maxRowsToRead: number;
  maxBytesToRead: number;
  maxMemoryUsage: number;
  maxConcurrentQueries: number;
  maxQueuedQueries: number;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function getClickHouseConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL?.trim() || "http://clickhouse:8123",
    username: env.CLICKHOUSE_USER?.trim() || "monitor",
    password: env.CLICKHOUSE_PASSWORD || "",
    database: env.CLICKHOUSE_DATABASE?.trim() || "new_api_monitor",
    readsEnabled: bool(env.CLICKHOUSE_READS_ENABLED),
    syncEnabled: bool(env.CLICKHOUSE_SYNC_ENABLED),
    syncBatchSize: int(env.CLICKHOUSE_SYNC_BATCH_SIZE, 5_000, 100, 20_000),
    syncPauseMs: int(env.CLICKHOUSE_SYNC_PAUSE_MS, 1_000, 100, 60_000),
    queryTimeoutMs: int(env.CLICKHOUSE_QUERY_TIMEOUT_MS, 3_000, 500, 10_000),
    maxThreads: int(env.CLICKHOUSE_MAX_THREADS, 2, 1, 2),
    maxRowsToRead: int(env.CLICKHOUSE_MAX_ROWS_TO_READ, 5_000_000, 10_000, 50_000_000),
    maxBytesToRead: int(env.CLICKHOUSE_MAX_BYTES_TO_READ, 1_073_741_824, 10_000_000, 10_737_418_240),
    maxMemoryUsage: int(env.CLICKHOUSE_MAX_MEMORY_USAGE, 536_870_912, 67_108_864, 2_147_483_648),
    maxConcurrentQueries: int(env.CLICKHOUSE_MAX_CONCURRENT_QUERIES, 2, 1, 2),
    maxQueuedQueries: int(env.CLICKHOUSE_MAX_QUEUED_QUERIES, 8, 0, 32),
  };
}
