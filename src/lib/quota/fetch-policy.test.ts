import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getQuotaFetchSkipReason } from "./fetch-policy.ts";

const baseAuthFile = {
  authIndex: "1",
  displayName: "account",
  type: "codex",
  provider: "codex",
  runtimeOnly: false,
  projectId: null,
  idToken: null,
  account: null,
};

describe("quota fetch policy", () => {
  it("does not skip disabled or unavailable accounts", () => {
    assert.equal(getQuotaFetchSkipReason({ ...baseAuthFile, disabled: true }), null);
    assert.equal(getQuotaFetchSkipReason({ ...baseAuthFile, unavailable: true }), null);
  });

  it("skips runtime-only Gemini CLI accounts", () => {
    assert.equal(
      getQuotaFetchSkipReason({
        ...baseAuthFile,
        type: "gemini-cli",
        provider: "gemini-cli",
        runtimeOnly: true,
      }),
      "Runtime-only (Skipped)",
    );
  });

  it("does not skip xAI Grok accounts after quota support is available", () => {
    assert.equal(
      getQuotaFetchSkipReason({
        ...baseAuthFile,
        type: "xai",
        provider: "xai",
      }),
      null,
    );
  });
});
