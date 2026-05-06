import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAntigravityQuotaGroups,
  buildCodexQuotaWindows,
  getCodexPlanLabel,
  normalizeCodexPlanType,
  resolveProviderType,
} from "./upstream.ts";

describe("upstream quota compatibility", () => {
  it("recognizes Claude auth files from the upstream provider list", () => {
    assert.equal(resolveProviderType({ type: "claude" }), "claude");
  });

  it("normalizes Codex plan labels including ProLite variants", () => {
    assert.equal(normalizeCodexPlanType("pro_lite"), "prolite");
    assert.equal(normalizeCodexPlanType("pro-lite"), "prolite");
    assert.equal(normalizeCodexPlanType("team"), "team");
    assert.equal(getCodexPlanLabel("pro_lite"), "Pro 5x");
    assert.equal(getCodexPlanLabel("pro"), "Pro 20x");
  });

  it("builds Codex windows for usage, code review, and additional rate limits", () => {
    const windows = buildCodexQuotaWindows({
      rate_limit: {
        primary_window: { limit_window_seconds: 604800, used_percent: 20, reset_at: 10 },
        secondary_window: { limit_window_seconds: 18000, used_percent: 35, reset_at: 20 },
      },
      code_review_rate_limit: {
        primary_window: { limit_window_seconds: 18000, used_percent: 40, reset_at: 30 },
        secondary_window: { limit_window_seconds: 604800, used_percent: 45, reset_at: 40 },
      },
      additional_rate_limits: [
        {
          limit_name: "gpt-5.1-codex",
          rate_limit: {
            primary_window: { used_percent: 50, reset_at: 50 },
            secondary_window: { used_percent: 55, reset_at: 60 },
          },
        },
      ],
    });

    assert.deepEqual(
      windows.map((window) => window.id),
      [
        "codex-five-hour",
        "codex-weekly",
        "code-review-five-hour",
        "code-review-weekly",
        "gpt-5-1-codex-five-hour-0",
        "gpt-5-1-codex-weekly-0",
      ],
    );
    assert.equal(windows[0].remainingPercent, 65);
    assert.equal(windows[1].remainingPercent, 80);
  });

  it("groups latest Antigravity quota models from upstream", () => {
    const groups = buildAntigravityQuotaGroups({
      "claude-sonnet-4-6": {
        quota_info: { remaining_fraction: 0.7, reset_time: "2026-05-06T01:00:00Z" },
      },
      "gemini-3.1-pro-high": {
        quota_info: { remaining_fraction: 0.4, reset_time: "2026-05-06T02:00:00Z" },
      },
      "gemini-3-flash": {
        quota_info: { remaining_fraction: 0.8 },
      },
      "gemini-3.1-flash-image": {
        displayName: "Gemini Image",
        quota_info: { remaining_fraction: 0.3 },
      },
    });

    assert.deepEqual(
      groups.map((group) => [group.id, group.label, group.remainingFraction]),
      [
        ["claude-gpt", "Claude/GPT", 0.7],
        ["gemini-3-1-pro-series", "Gemini 3.1 Pro Series", 0.4],
        ["gemini-3-flash", "Gemini 3 Flash", 0.8],
        ["gemini-image", "Gemini Image", 0.3],
      ],
    );
  });
});
