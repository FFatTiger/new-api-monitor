import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildZaiQuotaData, buildZaiQuotaWindows } from "./zai.ts";

describe("z.ai quota compatibility", () => {
  it("normalizes token usage ratio into remaining percentage", () => {
    const windows = buildZaiQuotaWindows({
      data: {
        limits: [
          { type: "REQUESTS_LIMIT", percentage: 15, nextResetTime: 1_800_000_000_000 },
          { type: "TOKENS_LIMIT", percentage: 0.753, nextResetTime: 1_800_000_100_000 },
        ],
      },
    });

    assert.deepEqual(
      windows.map((window) => window.id),
      ["tokens-limit", "requests-limit"],
    );
    assert.equal(windows[0].label, "Tokens");
    assert.equal(windows[0].usedPercent, 75.3);
    assert.equal(windows[0].remainingPercent, 24.7);
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
