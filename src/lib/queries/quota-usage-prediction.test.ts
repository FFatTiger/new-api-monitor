import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildQuotaUsagePrediction,
  getQuotaSnapshotRetentionSeconds,
  shouldWriteQuotaSnapshot,
} from "./quota-usage-prediction.ts";
import { QUOTA_USAGE_WINDOW_OPTIONS } from "../quota/usage-config.ts";

describe("quota usage prediction", () => {
  it("writes first snapshot and throttles unchanged snapshots for one minute", () => {
    assert.equal(shouldWriteQuotaSnapshot(null, { sampledAt: 1_000, resetTime: "a" }), true);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 950, resetTime: "a" }, { sampledAt: 1_000, resetTime: "a" }), false);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 939, resetTime: "a" }, { sampledAt: 1_000, resetTime: "a" }), true);
  });

  it("writes immediately when reset time changes meaningfully", () => {
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 990, resetTime: "old" }, { sampledAt: 1_000, resetTime: "new" }), true);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 990, resetTime: "1781138161" }, { sampledAt: 1_000, resetTime: "1781138162" }), false);
  });

  it("retains one day of minute snapshots plus sampling buffer", () => {
    const maxWindowMinutes = Math.max(...QUOTA_USAGE_WINDOW_OPTIONS.map((option) => option.minutes));
    assert.equal(getQuotaSnapshotRetentionSeconds(), maxWindowMinutes * 60 + 60);
  });

  it("builds an exhaustion estimate from selected-window snapshot percent slope", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8, 17],
      todayGptTokens: 12_000,
      todayQuota: 40_000,
      recentQuota: 30_000,
      windowMinutes: 360,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      latestSampledAt: 22_600,
      baselineUsedPercent: 37,
      baselineSampledAt: 1_000,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "ready");
    assert.equal(row.recentQuotaPerHour, 5_000);
    assert.equal(row.minutesLeft, 7200);
    assert.equal(row.exhaustAt, 433_000);
  });

  it("marks a provider safe when estimated exhaustion is after reset", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8],
      todayGptTokens: 0,
      todayQuota: 10_000,
      recentQuota: 10_000,
      windowMinutes: 60,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      latestSampledAt: 2_000,
      baselineUsedPercent: 39,
      baselineSampledAt: 1_000,
      resetTime: "2000",
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "safe_until_reset");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });

  it("reports no trend when the selected window has no percent increase", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8],
      todayGptTokens: 0,
      todayQuota: 10_000,
      recentQuota: 10_000,
      windowMinutes: 60,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      latestSampledAt: 2_000,
      baselineUsedPercent: 40,
      baselineSampledAt: 1_000,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "no_recent_usage");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
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
      latestSampledAt: 2_000,
      baselineUsedPercent: null,
      baselineSampledAt: null,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "no_recent_usage");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });
});
