import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { getClickHouseConfig, type ClickHouseConfig } from "./config.ts";

declare global {
  var __newApiMonitorClickHouseClient: ClickHouseClient | undefined;
}

export function createMonitorClickHouseClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: config.queryTimeoutMs + 1_000,
    clickhouse_settings: {
      max_threads: config.maxThreads,
      max_execution_time: Math.max(1, Math.ceil(config.queryTimeoutMs / 1_000)),
      timeout_overflow_mode: "throw",
      max_rows_to_read: String(config.maxRowsToRead),
      read_overflow_mode: "throw",
      max_bytes_to_read: String(config.maxBytesToRead),
      max_memory_usage: String(config.maxMemoryUsage),
      max_temporary_data_on_disk_size_for_query: "0",
      max_result_rows: "10000",
      result_overflow_mode: "throw",
      use_query_cache: 1,
      query_cache_ttl: 15,
    },
  });
}

export function getClickHouseClient(): ClickHouseClient {
  if (globalThis.__newApiMonitorClickHouseClient) {
    return globalThis.__newApiMonitorClickHouseClient;
  }
  const client = createMonitorClickHouseClient(getClickHouseConfig());
  globalThis.__newApiMonitorClickHouseClient = client;
  return client;
}
