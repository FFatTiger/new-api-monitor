import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getClickHouseConfig } from "./config.ts";

describe("clickhouse config", () => {
  it("is safe by default and clamps query CPU/concurrency", () => {
    const config = getClickHouseConfig({ CLICKHOUSE_MAX_THREADS: "99", CLICKHOUSE_MAX_CONCURRENT_QUERIES: "9" });
    assert.equal(config.readsEnabled, false);
    assert.equal(config.syncEnabled, false);
    assert.equal(config.maxThreads, 2);
    assert.equal(config.maxConcurrentQueries, 2);
    assert.equal(config.maxMemoryUsage, 536_870_912);
  });
});
