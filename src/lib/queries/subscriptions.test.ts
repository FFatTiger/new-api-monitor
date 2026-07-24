import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeUsageShare } from "./subscriptions.ts";

describe("computeUsageShare", () => {
  it("returns amount_used over total_used as a 0..1 fraction", () => {
    assert.equal(computeUsageShare("250", 1000), 0.25);
  });

  it("sums to 1 across all shares", () => {
    const rows = [
      { used: "300", total: 1000 },
      { used: "500", total: 1000 },
      { used: "200", total: 1000 },
    ];
    const sum = rows.reduce((acc, r) => acc + computeUsageShare(r.used, r.total), 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it("returns 0 when total is 0 to avoid divide-by-zero", () => {
    assert.equal(computeUsageShare("100", 0), 0);
  });

  it("treats non-numeric amount_used as 0", () => {
    assert.equal(computeUsageShare("abc", 1000), 0);
  });
});
