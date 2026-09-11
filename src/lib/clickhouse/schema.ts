import type { ClickHouseClient } from "@clickhouse/client";

/** v2 adds latency histograms (percentiles) and the error-classification table. */
export const CLICKHOUSE_SCHEMA_VERSION = 2;

/**
 * Latency histograms. Metrics mix units by design — the source columns do too:
 * `frt` is written by new-api in milliseconds, `use_time` in seconds. Each
 * metric gets its own bucket bounds so quantile estimates stay in its unit.
 * Bucket N is [bounds[N-1], bounds[N]); the last bucket is open-ended.
 */
export const FRT_BUCKET_BOUNDS_MS = [250, 500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const RESPONSE_BUCKET_BOUNDS_SECONDS = [1, 2, 5, 10, 20, 60, 120] as const;

export const HISTOGRAM_BUCKET_COUNT = FRT_BUCKET_BOUNDS_MS.length + 1;

/** Column names for a histogram, e.g. frtBucketColumn(0) -> frt_bucket_0. */
export function histogramBucketColumn(prefix: "frt" | "response", index: number): string {
  return `${prefix}_bucket_${index}`;
}

const latencyHistogramColumns = [
  ...Array.from({ length: HISTOGRAM_BUCKET_COUNT }, (_, index) =>
    `ADD COLUMN IF NOT EXISTS ${histogramBucketColumn("frt", index)} UInt32 DEFAULT 0`,
  ),
  ...Array.from({ length: HISTOGRAM_BUCKET_COUNT }, (_, index) =>
    `ADD COLUMN IF NOT EXISTS ${histogramBucketColumn("response", index)} UInt32 DEFAULT 0`,
  ),
];

export const CLICKHOUSE_DDL = [
  `CREATE TABLE IF NOT EXISTS dashboard_sync_state (
    singleton UInt8,
    last_source_id UInt64,
    synced_min_created_at Nullable(UInt64),
    synced_max_created_at Nullable(UInt64),
    version UInt64
  ) ENGINE = ReplacingMergeTree(version) ORDER BY singleton`,
  `CREATE TABLE IF NOT EXISTS dashboard_dimensions (
    kind LowCardinality(String),
    value String,
    label String,
    version UInt64
  ) ENGINE = ReplacingMergeTree(version) ORDER BY (kind, value)`,
  `CREATE TABLE IF NOT EXISTS dashboard_minute_batches (
    batch_id UInt64,
    version UInt64,
    bucket_start UInt64,
    token_id UInt64,
    token_name LowCardinality(String),
    user_id UInt64,
    username LowCardinality(String),
    model_name LowCardinality(String),
    channel_id UInt64,
    channel_name LowCardinality(String),
    request_count UInt64,
    input_tokens UInt64,
    output_tokens UInt64,
    cache_tokens UInt64,
    attempt_count UInt64,
    success_count UInt64,
    error_count UInt64,
    first_token_latency_sum Float64,
    first_token_latency_count UInt64,
    response_time_sum Float64,
    response_time_count UInt64,
    output_speed_sum Float64,
    output_speed_count UInt64,
    first_used_at UInt64,
    latest_used_at UInt64,
    INDEX idx_token token_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_user user_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_model model_name TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_channel channel_id TYPE bloom_filter(0.01) GRANULARITY 4
  ) ENGINE = ReplacingMergeTree(version)
    PARTITION BY toYYYYMM(toDateTime(bucket_start, 'Asia/Shanghai'))
    ORDER BY (bucket_start, model_name, channel_id, user_id, token_id, token_name, username, batch_id)`,
  // Additive migration: existing rows keep zeroed buckets, so percentiles
  // accumulate from the moment this ships. No resync, no query breakage.
  `ALTER TABLE dashboard_minute_batches ${latencyHistogramColumns.join(", ")}`,
  `CREATE TABLE IF NOT EXISTS dashboard_error_batches (
    batch_id UInt64,
    version UInt64,
    bucket_start UInt64,
    error_type LowCardinality(String),
    status_code UInt16,
    token_id UInt64,
    token_name LowCardinality(String),
    user_id UInt64,
    username LowCardinality(String),
    model_name LowCardinality(String),
    channel_id UInt64,
    channel_name LowCardinality(String),
    error_count UInt64,
    latest_used_at UInt64
  ) ENGINE = ReplacingMergeTree(version)
    PARTITION BY toYYYYMM(toDateTime(bucket_start, 'Asia/Shanghai'))
    ORDER BY (bucket_start, error_type, status_code, model_name, channel_id, user_id, token_id, token_name, username, batch_id)`,
  // The error table backfills from its own cursor, independent of the main
  // sync cursor, so classified history starts empty and drains in the
  // background without blocking dashboard sync.
  `CREATE TABLE IF NOT EXISTS dashboard_error_sync_state (
    singleton UInt8,
    last_source_id UInt64,
    version UInt64
  ) ENGINE = ReplacingMergeTree(version) ORDER BY singleton`,
] as const;

export async function ensureClickHouseSchema(client: ClickHouseClient): Promise<void> {
  for (const query of CLICKHOUSE_DDL) {
    await client.command({ query });
  }
}
