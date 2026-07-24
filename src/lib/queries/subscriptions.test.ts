import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeSubscriptionStats, computeUsageShare } from "./subscription-stats.ts";

describe("computeSubscriptionStats", () => {
  it("sums amount_used and amount_total across rows", () => {
    const rows = [
      { amountUsed: "100", amountTotal: "1000" },
      { amountUsed: "300", amountTotal: "2000" },
    ] as const;
    assert.deepEqual(computeSubscriptionStats([...rows]), { totalUsed: 400, totalQuota: 3000 });
  });

  it("handles empty rows", () => {
    assert.deepEqual(computeSubscriptionStats([]), { totalUsed: 0, totalQuota: 0 });
  });

  it("treats non-numeric quota as 0", () => {
    const rows = [{ amountUsed: "abc", amountTotal: "" }] as const;
    assert.deepEqual(computeSubscriptionStats([...rows]), { totalUsed: 0, totalQuota: 0 });
  });
});

describe("computeUsageShare", () => {
  it("returns amount_used over total_used as a 0..1 fraction", () => {
    assert.equal(computeUsageShare("250", 1000), 0.25);
  });

  it("returns 0 when total is 0 to avoid divide-by-zero", () => {
    assert.equal(computeUsageShare("100", 0), 0);
  });
});
