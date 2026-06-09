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

  it("does not use MiniMax short windows for quota prediction when weekly quota is missing", () => {
    assert.equal(
      getQuotaWindowSnapshot("minimax", {
        windows: [{ id: "minimax-hour", label: "5小时额度", remainingPercent: 50, usedPercent: 50, resetTime: "short-reset" }],
      }),
      null,
    );
  });

  it("uses the Z.ai weekly window for quota prediction instead of the short token window", () => {
    const snapshot = getQuotaWindowSnapshot("zai", {
      windows: [
        { id: "tokens-limit", label: "5小时额度", remainingPercent: 91, usedPercent: 9, resetTime: "short-reset" },
        { id: "requests-limit", label: "周额度", remainingPercent: 80, usedPercent: 20, resetTime: "weekly-reset" },
      ],
    });

    assert.deepEqual(snapshot, {
      remainingPercent: 80,
      usedPercent: 20,
      resetTime: "weekly-reset",
    });
  });

  it("falls back to remaining percent derived from used percent", () => {
    const snapshot = getQuotaWindowSnapshot("codex", {
      windows: [{ id: "codex-weekly", label: "周窗口", usedPercent: 42, resetTime: 123 }],
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
