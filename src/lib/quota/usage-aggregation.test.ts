import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateProviderQuotaSnapshot, getQuotaWindowSnapshot } from "./usage-aggregation.ts";
import type { QuotaData } from "@/types/quota";

describe("quota usage aggregation", () => {
  it("selects a weekly Codex window with remaining percent and reset time", () => {
    const data: QuotaData = {
      windows: [
        { id: "codex-five-hour", label: "5小时", remainingPercent: 80, resetTime: "soon" },
        { id: "codex-weekly", label: "周窗口", remainingPercent: 35, resetTime: "week-reset" },
      ],
    };

    assert.deepEqual(getQuotaWindowSnapshot("codex", data), {
      remainingPercent: 35,
      usedPercent: 65,
      resetTime: "week-reset",
    });
  });

  it("aggregates multiple cards by the lowest remaining percent", () => {
    const snapshot = aggregateProviderQuotaSnapshot("codex", [
      { windows: [{ id: "codex-weekly", remainingPercent: 70, resetTime: "same" }] },
      { windows: [{ id: "codex-weekly", remainingPercent: 20, resetTime: "same" }] },
    ]);

    assert.deepEqual(snapshot, {
      provider: "codex",
      remainingPercent: 20,
      usedPercent: 80,
      resetTime: "same",
    });
  });

  it("falls back to remaining percent derived from used percent", () => {
    const snapshot = getQuotaWindowSnapshot("zai", {
      windows: [{ id: "tokens-limit", usedPercent: 42, resetTime: 123 }],
    });

    assert.deepEqual(snapshot, {
      remainingPercent: 58,
      usedPercent: 42,
      resetTime: 123,
    });
  });

  it("returns null when no usable quota percentage exists", () => {
    assert.equal(aggregateProviderQuotaSnapshot("codex", [{ windows: [{ id: "codex-weekly" }] }]), null);
  });
});
