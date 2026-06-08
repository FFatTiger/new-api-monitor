import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildQuotaUsagePrediction,
  getQuotaSnapshotRetentionSeconds,
  shouldWriteQuotaSnapshot,
} from "./quota-usage-prediction.ts";
import { QUOTA_USAGE_WINDOW_OPTIONS } from "../quota/usage-config.ts";

describe("quota usage prediction", () => {
  it("writes first snapshot and throttles unchanged snapshots for five minutes", () => {
    assert.equal(shouldWriteQuotaSnapshot(null, { sampledAt: 1_000, resetTime: "a" }), true);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 900, resetTime: "a" }, { sampledAt: 1_000, resetTime: "a" }), false);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 699, resetTime: "a" }, { sampledAt: 1_000, resetTime: "a" }), true);
  });

  it("writes immediately when reset time changes", () => {
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 990, resetTime: "old" }, { sampledAt: 1_000, resetTime: "new" }), true);
  });

  it("retains snapshots only for the largest selectable window plus sampling buffer", () => {
    const maxWindowMinutes = Math.max(...QUOTA_USAGE_WINDOW_OPTIONS.map((option) => option.minutes));
    assert.equal(getQuotaSnapshotRetentionSeconds(), maxWindowMinutes * 60 + 5 * 60);
  });

  it("builds an exhaustion estimate from today quota, used percent, and recent speed", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8, 17],
      todayGptTokens: 12_000,
      todayQuota: 40_000,
      recentQuota: 20_000,
      windowMinutes: 60,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: "week",
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "ready");
    assert.equal(row.recentQuotaPerHour, 20_000);
    assert.equal(row.minutesLeft, 180);
    assert.equal(row.exhaustAt, 11_800);
  });

  it("reports no recent usage when speed is zero", () => {
    const row = buildQuotaUsagePrediction({
      provider: "claude",
      channelIds: [12],
      todayGptTokens: 0,
      todayQuota: 0,
      recentQuota: 0,
      windowMinutes: 720,
      latestRemainingPercent: 80,
      latestUsedPercent: 20,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "no_recent_usage");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });
});
