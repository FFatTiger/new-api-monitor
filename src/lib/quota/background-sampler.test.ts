import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProviderQuotaSnapshotsFromLatestRows } from "./background-sampler.ts";
import type { AuthFile } from "../../types/auth.ts";

const authFile = (authIndex: string, type = "codex"): AuthFile => ({
  authIndex,
  displayName: authIndex,
  type,
  provider: type,
  runtimeOnly: false,
  projectId: null,
});

describe("quota background sampler", () => {
  it("builds provider-level prediction snapshots from successful latest cache rows only", () => {
    const snapshots = buildProviderQuotaSnapshotsFromLatestRows(
      [authFile("8"), authFile("9"), authFile("skipped", "xai"), authFile("missing")],
      [
        {
          authIndex: "8",
          provider: "codex",
          quotaData: {
            windows: [
              { id: "codex-five-hour", label: "5小时窗口", remainingPercent: 95, usedPercent: 5, resetTime: "short" },
              { id: "codex-weekly", label: "周窗口", remainingPercent: 70, usedPercent: 30, resetTime: "weekly" },
            ],
          },
          error: null,
          sampledAt: 1_700_000_000,
          successCount: 0,
          failureCount: 0,
        },
        {
          authIndex: "9",
          provider: "codex",
          quotaData: {
            windows: [{ id: "codex-weekly", label: "周窗口", remainingPercent: 65, usedPercent: 35, resetTime: "weekly" }],
          },
          error: null,
          sampledAt: 1_700_000_000,
          successCount: 0,
          failureCount: 0,
        },
        {
          authIndex: "skipped",
          provider: "xai",
          quotaData: null,
          error: "Grok quota unavailable (Skipped)",
          sampledAt: 1_700_000_000,
          successCount: 0,
          failureCount: 0,
        },
      ],
    );

    assert.deepEqual(snapshots, [
      {
        provider: "codex",
        remainingPercent: 65,
        usedPercent: 35,
        resetTime: "weekly",
      },
    ]);
  });
});
