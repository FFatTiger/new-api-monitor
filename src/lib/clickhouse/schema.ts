import type { ClickHouseClient } from "@clickhouse/client";

export const CLICKHOUSE_SCHEMA_VERSION = 1;

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
] as const;

export async function ensureClickHouseSchema(client: ClickHouseClient): Promise<void> {
  for (const query of CLICKHOUSE_DDL) {
    await client.command({ query });
  }
}
