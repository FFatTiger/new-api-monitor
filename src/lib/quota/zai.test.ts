import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildZaiQuotaData, buildZaiQuotaWindows } from "./zai.ts";

describe("z.ai quota compatibility", () => {
  it("treats percentage as a 0-100 used percentage even when the value is 1", () => {
    const windows = buildZaiQuotaWindows({
      data: {
        limits: [
          { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 15, nextResetTime: 1_800_000_000_000 },
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 1, nextResetTime: 1_800_000_100_000 },
        ],
      },
    });

    assert.deepEqual(
      windows.map((window) => window.id),
      ["tokens-limit", "time-limit"],
    );
    assert.equal(windows[0].label, "5小时额度");
    assert.equal(windows[1].label, "周额度");
    assert.equal(windows[0].usedPercent, 1);
    assert.equal(windows[0].remainingPercent, 99);
    assert.equal(windows[0].resetTime, 1_800_000_100_000);
  });

  it("accepts percent values already returned on a 0-100 scale", () => {
    const windows = buildZaiQuotaWindows({
      data: {
        limits: [{ type: "TOKENS_LIMIT", percentage: 75.3 }],
      },
    });

    assert.equal(windows[0].usedPercent, 75.3);
    assert.equal(windows[0].remainingPercent, 24.7);
  });

  it("preserves the account level as a plan badge", () => {
    const data = buildZaiQuotaData({
      data: {
        level: "pro",
        limits: [{ type: "TOKENS_LIMIT", percentage: 20 }],
      },
    });

    assert.equal(data.planType, "pro");
    assert.equal(data.tierLabel, "Pro");
  });
});
