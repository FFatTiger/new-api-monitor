import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQuotaStatesFromLatestRows } from "./quota-latest.ts";
import type { AuthFile } from "../../types/auth.ts";

const baseFile = (authIndex: string, type = "codex"): AuthFile => ({
  authIndex,
  displayName: `auth-${authIndex}`,
  type,
  provider: type,
  runtimeOnly: false,
  projectId: null,
});

describe("quota latest cache mapping", () => {
  it("maps cached success rows into quota states without marking them loading", () => {
    const states = buildQuotaStatesFromLatestRows(
      [baseFile("8")],
      [
        {
          authIndex: "8",
          provider: "codex",
          quotaData: { windows: [{ id: "codex-weekly", remainingPercent: 72, usedPercent: 28 }] },
          error: null,
          sampledAt: 1_700_000_123,
          successCount: 12,
          failureCount: 3,
        },
      ],
    );

    assert.deepEqual(states["8"], {
      loading: false,
      data: { windows: [{ id: "codex-weekly", remainingPercent: 72, usedPercent: 28 }] },
      lastUpdated: 1_700_000_123_000,
      successCount: 12,
      failureCount: 3,
    });
  });

  it("uses the cached error row or a waiting message instead of asking the browser to fetch upstream quota", () => {
    const states = buildQuotaStatesFromLatestRows(
      [baseFile("8"), baseFile("runtime", "gemini-cli")],
      [
        {
          authIndex: "runtime",
          provider: "gemini-cli",
          quotaData: null,
          error: "Runtime-only (Skipped)",
          sampledAt: 1_700_000_222,
          successCount: 0,
          failureCount: 0,
        },
      ],
    );

    assert.equal(states["8"].loading, false);
    assert.equal(states["8"].error, "等待后台采样");
    assert.equal(states["runtime"].loading, false);
    assert.equal(states["runtime"].error, "Runtime-only (Skipped)");
    assert.equal(states["runtime"].lastUpdated, 1_700_000_222_000);
  });
});
