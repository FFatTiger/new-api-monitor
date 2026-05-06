import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sortQuotaFiles } from "./sort-policy.ts";

const baseAuthFile = {
  authIndex: "0",
  displayName: "account",
  type: "codex",
  provider: "codex",
  runtimeOnly: false,
  projectId: null,
  idToken: null,
  account: null,
};

describe("quota sort policy", () => {
  it("sorts Codex accounts by plan tier in the default order", () => {
    const files = [
      { ...baseAuthFile, authIndex: "free", displayName: "free", planType: "free" },
      { ...baseAuthFile, authIndex: "plus", displayName: "plus", planType: "plus" },
      { ...baseAuthFile, authIndex: "pro-lite", displayName: "pro-lite", planType: "pro_lite" },
      { ...baseAuthFile, authIndex: "pro", displayName: "pro", planType: "pro" },
    ];

    assert.deepEqual(
      sortQuotaFiles(files, {}, "codex").map((file) => file.authIndex),
      ["pro", "pro-lite", "plus", "free"],
    );
  });

  it("uses refreshed quota data before auth file plan metadata", () => {
    const files = [
      { ...baseAuthFile, authIndex: "stale-pro", displayName: "stale-pro", planType: "pro" },
      { ...baseAuthFile, authIndex: "fresh-pro", displayName: "fresh-pro", planType: "free" },
    ];

    assert.deepEqual(
      sortQuotaFiles(
        files,
        {
          "stale-pro": { loading: false, data: { plan_type: "free" } },
          "fresh-pro": { loading: false, data: { plan_type: "pro" } },
        },
        "codex",
      ).map((file) => file.authIndex),
      ["fresh-pro", "stale-pro"],
    );
  });
});
