import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estimateQuantileFromHistogram,
  histogramAggregateSql,
} from "./latency-histogram.ts";
import { FRT_BUCKET_BOUNDS_MS } from "./schema.ts";

const BOUNDS = [100, 200, 300]; // four buckets: <100, <200, <300, open

describe("latency quantile estimation", () => {
  it("returns null without samples", () => {
    assert.equal(estimateQuantileFromHistogram([], BOUNDS, 0.95), null);
    assert.equal(estimateQuantileFromHistogram([0, 0, 0, 0], BOUNDS, 0.95), null);
    assert.equal(estimateQuantileFromHistogram(null, BOUNDS, 0.95), null);
    assert.equal(estimateQuantileFromHistogram([1, 0, 0, 0], BOUNDS, Number.NaN), null);
  });

  it("interpolates inside the bucket that contains the quantile", () => {
    // 100 samples all in bucket 0 (<100ms): p50 lands mid-bucket.
    assert.equal(estimateQuantileFromHistogram([100, 0, 0, 0], BOUNDS, 0.5), 50);
    // 90 in <100 and 10 in <200: p95 sits halfway through the second bucket.
    assert.equal(estimateQuantileFromHistogram([90, 10, 0, 0], BOUNDS, 0.95), 150);
  });

  it("returns the bound for the open-ended last bucket instead of inventing a tail", () => {
    assert.equal(estimateQuantileFromHistogram([0, 0, 0, 10], BOUNDS, 0.99), 300);
    assert.equal(estimateQuantileFromHistogram([1, 0, 0, 99], BOUNDS, 1), 300);
  });

  it("ignores malformed sample counts", () => {
    assert.equal(estimateQuantileFromHistogram(["5", "-2", null, 3], BOUNDS, 0.99), 300);
  });

  it("estimates realistic first-token percentiles in milliseconds", () => {
    // 90 fast (<250ms) and 10 slow (<10s): p50 stays inside the first bucket,
    // while p95 falls into the 5–10s tail bucket.
    const histogram = [90, 0, 0, 0, 0, 10, 0, 0];
    const p50 = estimateQuantileFromHistogram(histogram, FRT_BUCKET_BOUNDS_MS, 0.5);
    const p95 = estimateQuantileFromHistogram(histogram, FRT_BUCKET_BOUNDS_MS, 0.95);
    assert.ok(p50 !== null && p50 > 0 && p50 < 250);
    assert.ok(p95 !== null && p95 >= 5_000 && p95 <= 10_000);
  });
});

describe("histogram SQL", () => {
  it("builds an array aggregate over the stored bucket columns", () => {
    const sql = histogramAggregateSql("frt", 3);
    assert.match(sql, /^\[sum\(frt_bucket_0\), sum\(frt_bucket_1\), sum\(frt_bucket_2\)\] AS frt_hist$/);
  });
});
