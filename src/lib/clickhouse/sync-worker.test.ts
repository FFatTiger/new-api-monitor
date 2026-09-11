import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateErrorBatch,
  aggregateSyncBatch,
  histogramBucketIndex,
  parseErrorClassifier,
  toMinuteBatchInsertRow,
  type ErrorSourceLogRow,
} from "./sync-worker.ts";
import { FRT_BUCKET_BOUNDS_MS, RESPONSE_BUCKET_BOUNDS_SECONDS } from "./schema.ts";
import type { DashboardSourceLogRow } from "../dashboard/types.ts";

const row = (id: number): DashboardSourceLogRow => ({
  id, created_at: 1_700_000_001, token_id: 1, token_name: "key", user_id: 2,
  username: "user", model_name: "model (x)", channel_id: 3, channel_name: "channel",
  prompt_tokens: 10, completion_tokens: 5, type: 2, use_time: 1,
  other: '{"cache_tokens":2,"usage_semantic":"openai","frt":0.2}',
});

describe("clickhouse sync aggregation", () => {
  it("uses a deterministic batch id and combines identical minute dimensions", () => {
    const cells = aggregateSyncBatch([row(10), row(11)]);
    assert.equal(cells.length, 1);
    assert.equal(cells[0]?.batch_id, "10");
    assert.equal(cells[0]?.version, "11");
    assert.equal(cells[0]?.request_count, "2");
    assert.equal(cells[0]?.input_tokens, "20");
    assert.equal(cells[0]?.output_tokens, "10");
  });

  it("does not split one dimension when only the channel display name changes", () => {
    const changed = { ...row(11), channel_name: "renamed channel" };
    const cells = aggregateSyncBatch([row(10), changed]);
    assert.equal(cells.length, 1);
    assert.equal(cells[0]?.channel_name, "renamed channel");
  });
});

describe("latency histograms", () => {
  it("buckets values against ascending bounds with an open-ended last bucket", () => {
    const bounds = [10, 20, 30];
    assert.equal(histogramBucketIndex(0, bounds), 0);
    assert.equal(histogramBucketIndex(9.99, bounds), 0);
    assert.equal(histogramBucketIndex(10, bounds), 1);
    assert.equal(histogramBucketIndex(29, bounds), 2);
    assert.equal(histogramBucketIndex(30, bounds), 3);
    assert.equal(histogramBucketIndex(10_000, bounds), 3);
  });

  it("counts first-token milliseconds and response seconds in their own buckets", () => {
    const fast = { ...row(10), other: '{"frt":200}', use_time: 1 };
    const slow = { ...row(11), other: '{"frt":9000}', use_time: 45 };
    const cells = aggregateSyncBatch([fast, slow]);

    assert.equal(cells.length, 1);
    const cell = cells[0]!;
    assert.equal(cell.frtBuckets[histogramBucketIndex(200, FRT_BUCKET_BOUNDS_MS)], 1);
    assert.equal(cell.frtBuckets[histogramBucketIndex(9000, FRT_BUCKET_BOUNDS_MS)], 1);
    assert.equal(cell.responseBuckets[histogramBucketIndex(1, RESPONSE_BUCKET_BOUNDS_SECONDS)], 1);
    assert.equal(cell.responseBuckets[histogramBucketIndex(45, RESPONSE_BUCKET_BOUNDS_SECONDS)], 1);
    assert.equal(cell.frtBuckets.reduce((sum, count) => sum + count, 0), 2);
    assert.equal(cell.responseBuckets.reduce((sum, count) => sum + count, 0), 2);
  });

  it("flattens histogram arrays onto the stored bucket columns", () => {
    const cells = aggregateSyncBatch([row(10)]);
    const inserted = toMinuteBatchInsertRow(cells[0]!);

    assert.equal("frtBuckets" in inserted, false);
    assert.equal("responseBuckets" in inserted, false);
    assert.equal(inserted.frt_bucket_0, 1);
    assert.equal(inserted.frt_bucket_7, 0);
    assert.equal(inserted.frt_bucket_6, 0);
    assert.equal(inserted.response_bucket_0, 0);
    assert.equal(inserted.request_count, "1");
  });
});

describe("error classification", () => {
  const errorRow = (id: number, other: string, overrides: Partial<ErrorSourceLogRow> = {}): ErrorSourceLogRow => ({
    id,
    created_at: 1_700_000_001,
    token_id: 11,
    token_name: "sk-alpha",
    user_id: 1,
    username: "root",
    model_name: "model (x)",
    channel_id: 3,
    channel_name: "channel",
    other,
    ...overrides,
  });

  it("reads error_type and status_code from the error payload", () => {
    assert.deepEqual(parseErrorClassifier('{"error_type":"openai_error","status_code":429}'), {
      errorType: "openai_error",
      statusCode: 429,
    });
    assert.deepEqual(parseErrorClassifier('{"errorType":"claude_error","statusCode":"503"}'), {
      errorType: "claude_error",
      statusCode: 503,
    });
  });

  it("falls back to unknown_error for missing, malformed or out-of-range classifiers", () => {
    assert.deepEqual(parseErrorClassifier('{"frt":12}'), { errorType: "unknown_error", statusCode: 0 });
    assert.deepEqual(parseErrorClassifier("not json"), { errorType: "unknown_error", statusCode: 0 });
    assert.deepEqual(parseErrorClassifier(null), { errorType: "unknown_error", statusCode: 0 });
    assert.deepEqual(parseErrorClassifier('{"error_type":"  "}'), { errorType: "unknown_error", statusCode: 0 });
    assert.deepEqual(parseErrorClassifier('{"error_type":"x","status_code":99999}'), {
      errorType: "x",
      statusCode: 0,
    });
  });

  it("groups errors by minute, classifier, model and channel", () => {
    const cells = aggregateErrorBatch(
      [
        errorRow(10, '{"error_type":"openai_error","status_code":429}', { channel_name: "ch-a" }),
        errorRow(11, '{"error_type":"openai_error","status_code":429}', { channel_name: "ch-a" }),
        errorRow(12, '{"error_type":"openai_error","status_code":503}', { channel_name: "ch-a" }),
        errorRow(13, '{"error_type":"new_api_error","status_code":500}', { model_name: "other", channel_id: 9 }),
      ],
      BigInt(7),
    );

    assert.equal(cells.length, 3);
    const openai429 = cells.find((cell) => cell.error_type === "openai_error" && cell.status_code === 429)!;
    assert.equal(openai429.error_count, "2");
    assert.equal(openai429.batch_id, "7");
    assert.equal(openai429.version, "13");
    assert.equal(openai429.channel_name, "ch-a");
    assert.equal(openai429.bucket_start, Math.floor(1_700_000_001 / 60) * 60);

    const newApi500 = cells.find((cell) => cell.error_type === "new_api_error")!;
    assert.equal(newApi500.model_name, "other");
    assert.equal(newApi500.channel_id, "9");
    assert.equal(aggregateErrorBatch([]).length, 0);
  });
});
