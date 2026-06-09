import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildQuotaUsagePrediction,
  getQuotaSnapshotRetentionSeconds,
  getQuotaUsageWindowStartSeconds,
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

  it("builds an exhaustion estimate from the quota window usage basis", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8, 17],
      todayGptTokens: 12_000,
      todayQuota: 40_000,
      quotaWindowUsage: 400_000,
      recentQuota: 20_000,
      windowMinutes: 60,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "ready");
    assert.equal(row.recentQuotaPerHour, 20_000);
    assert.equal(row.minutesLeft, 1800);
    assert.equal(row.exhaustAt, 109_000);
  });

  it("uses the weekly window start for Codex and Claude reset times", () => {
    assert.equal(getQuotaUsageWindowStartSeconds("codex", "1781138161"), 1781138161 - 7 * 24 * 60 * 60);
    assert.equal(getQuotaUsageWindowStartSeconds("claude", "1781138161000"), 1781138161 - 7 * 24 * 60 * 60);
    assert.equal(getQuotaUsageWindowStartSeconds("zai", "1781138161000"), null);
  });

  it("marks a provider safe when estimated exhaustion is after reset", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8],
      todayGptTokens: 0,
      todayQuota: 10_000,
      quotaWindowUsage: 400_000,
      recentQuota: 10_000,
      windowMinutes: 60,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: "2000",
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "safe_until_reset");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });

  it("reports no recent usage when speed is zero", () => {
    const row = buildQuotaUsagePrediction({
      provider: "claude",
      channelIds: [12],
      todayGptTokens: 0,
      todayQuota: 0,
      quotaWindowUsage: 0,
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
