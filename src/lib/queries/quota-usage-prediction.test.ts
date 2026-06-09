import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceQuotaUsageCoefficient,
  buildQuotaUsagePrediction,
  getQuotaSnapshotRetentionSeconds,
  shouldWriteQuotaSnapshot,
} from "./quota-usage-prediction.ts";

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
    assert.equal(getQuotaSnapshotRetentionSeconds(), 24 * 60 * 60 + 60);
  });

  it("accumulates quota while percent is unchanged, then updates the single quota coefficient", () => {
    const unchanged = advanceQuotaUsageCoefficient(
      {
        quotaPerPercent: null,
        pendingQuota: 100,
        pendingStartedAt: 1_000,
        pendingStartedUsedPercent: 52,
        lastSnapshotAt: 1_060,
        lastUsedPercent: 52,
        lastResetTime: "1781138161",
        lastIntervalQuota: 100,
        lastIntervalMinutes: 1,
      },
      { sampledAt: 1_120, usedPercent: 52, resetTime: "1781138162" },
      250,
    );

    assert.equal(unchanged.quotaPerPercent, null);
    assert.equal(unchanged.pendingQuota, 350);
    assert.equal(unchanged.pendingStartedUsedPercent, 52);
    assert.equal(unchanged.lastIntervalQuota, 250);
    assert.equal(unchanged.lastIntervalMinutes, 1);

    const changed = advanceQuotaUsageCoefficient(
      unchanged,
      { sampledAt: 1_180, usedPercent: 53, resetTime: "1781138161" },
      150,
    );

    assert.equal(changed.quotaPerPercent, 500);
    assert.equal(changed.pendingQuota, 0);
    assert.equal(changed.pendingStartedAt, 1_180);
    assert.equal(changed.pendingStartedUsedPercent, 53);
    assert.equal(changed.lastIntervalQuota, 150);
    assert.equal(changed.lastIntervalMinutes, 1);
  });

  it("resets coefficient calibration when used percent decreases", () => {
    const state = advanceQuotaUsageCoefficient(
      {
        quotaPerPercent: 500,
        pendingQuota: 200,
        pendingStartedAt: 1_000,
        pendingStartedUsedPercent: 53,
        lastSnapshotAt: 1_060,
        lastUsedPercent: 53,
        lastResetTime: "1781138161",
        lastIntervalQuota: 200,
        lastIntervalMinutes: 1,
      },
      { sampledAt: 1_120, usedPercent: 1, resetTime: "1781742961" },
      300,
    );

    assert.equal(state.quotaPerPercent, null);
    assert.equal(state.pendingQuota, 0);
    assert.equal(state.pendingStartedAt, 1_120);
    assert.equal(state.pendingStartedUsedPercent, 1);
  });

  it("builds an exhaustion estimate from the quota coefficient and latest interval speed", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8, 17],
      todayGptTokens: 12_000,
      todayQuota: 40_000,
      quotaPerPercent: 100_000,
      recentQuota: 50_000,
      recentMinutes: 1,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "ready");
    assert.equal(row.recentQuotaPerHour, 3_000_000);
    assert.equal(row.minutesLeft, 120);
    assert.equal(row.exhaustAt, 8_200);
  });

  it("marks a provider safe when estimated exhaustion is after reset", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8],
      todayGptTokens: 0,
      todayQuota: 10_000,
      quotaPerPercent: 100_000,
      recentQuota: 10_000,
      recentMinutes: 1,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: "2000",
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "safe_until_reset");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });

  it("reports calibration pending before a quota coefficient is known", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8],
      todayGptTokens: 0,
      todayQuota: 10_000,
      quotaPerPercent: null,
      recentQuota: 10_000,
      recentMinutes: 1,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "calibrating");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });

  it("reports no recent usage when speed is zero", () => {
    const row = buildQuotaUsagePrediction({
      provider: "claude",
      channelIds: [12],
      todayGptTokens: 0,
      todayQuota: 0,
      quotaPerPercent: 100_000,
      recentQuota: 0,
      recentMinutes: 1,
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
