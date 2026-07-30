import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/clickhouse/query.ts"), "utf8");

describe("clickhouse query safety", () => {
  it("binds every optional dimension filter and never references PostgreSQL logs", () => {
    assert.match(SOURCE, /positionCaseInsensitiveUTF8\(token_name, \{token:String\}\)/);
    assert.match(SOURCE, /\{username:String\}/);
    assert.match(SOURCE, /\{model:String\}/);
    assert.match(SOURCE, /\{channel:UInt64\}/);
    assert.match(SOURCE, /query_params/);
    assert.match(SOURCE, /maxConcurrentQueries/);
    assert.match(SOURCE, /maxQueuedQueries/);
    assert.match(SOURCE, /CLICKHOUSE_QUERY_QUEUE_TIMEOUT/);
    assert.match(SOURCE, /wait_end_of_query:\s*1/);
    assert.match(SOURCE, /SELECT \* FROM \(SELECT 'token'/);
    assert.match(SOURCE, /SELECT \* FROM \(SELECT 'model' kind/);
    assert.match(SOURCE, /sum\(input_tokens\) input_sum/);
    assert.doesNotMatch(SOURCE, /sum\(input_tokens\) input_tokens/);
    assert.doesNotMatch(SOURCE, /FROM\s+logs/i);
  });

  it("deduplicates retried immutable batches without FINAL", () => {
    assert.match(SOURCE, /GROUP BY batch_id, bucket_start, token_id, token_name, user_id, username, model_name, channel_id/);
    assert.match(SOURCE, /argMax\(request_count, version\)/);
    assert.doesNotMatch(SOURCE, /\bFINAL\b/);
  });
});
