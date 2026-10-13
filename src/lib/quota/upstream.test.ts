import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAntigravityQuotaGroups,
  buildAntigravityQuotaSummaryGroups,
  buildCodexQuotaWindows,
  getCodexPlanLabel,
  normalizeCodexPlanType,
  resolveProviderType,
} from "./upstream.ts";

describe("upstream quota compatibility", () => {
  it("recognizes Claude auth files from the upstream provider list", () => {
    assert.equal(resolveProviderType({ type: "claude" }), "claude");
  });

  it("recognizes xAI Grok auth files from the upstream provider list", () => {
    assert.equal(resolveProviderType({ type: "xai" }), "xai");
    assert.equal(resolveProviderType({ type: "grok" }), "xai");
  });

  it("recognizes Z.ai auth files from the server-side quota provider list", () => {
    assert.equal(resolveProviderType({ type: "zai" }), "zai");
    assert.equal(resolveProviderType({ type: "z.ai" }), "zai");
  });

  it("recognizes MiniMax auth files from the server-side quota provider list", () => {
    assert.equal(resolveProviderType({ type: "minimax" }), "minimax");
    assert.equal(resolveProviderType({ type: "mini-max" }), "minimax");
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

  it("uses Antigravity's shared 7-day and 5-hour pools", () => {
    const groups = buildAntigravityQuotaSummaryGroups({
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [
            { window: "weekly", remainingFraction: 0.9555427, resetTime: "2026-10-17T15:34:29Z" },
            { window: "5h", remainingFraction: 1, resetTime: "2026-10-13T11:26:50Z" },
          ],
        },
        {
          displayName: "Claude and GPT models",
          buckets: [
            { window: "weekly", remainingFraction: 0.999936, resetTime: "2026-10-20T06:04:50Z" },
            { window: "5h", remainingFraction: 0.999872, resetTime: "2026-10-13T11:04:50Z" },
          ],
        },
      ],
    });

    assert.deepEqual(
      groups.map((group) => [group.id, group.label, group.remainingFraction, group.resetTime]),
      [
        ["gemini-7-days", "Gemini \u00b7 7 days", 0.9555427, "2026-10-17T15:34:29Z"],
        ["gemini-5-hours", "Gemini \u00b7 5 hours", 1, "2026-10-13T11:26:50Z"],
        ["claude-gpt-7-days", "Claude & GPT \u00b7 7 days", 0.999936, "2026-10-20T06:04:50Z"],
        ["claude-gpt-5-hours", "Claude & GPT \u00b7 5 hours", 0.999872, "2026-10-13T11:04:50Z"],
      ],
    );
  });
});
