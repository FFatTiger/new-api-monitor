import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMiniMaxAuthFile, buildZaiAuthFile, sanitizeAuthFile } from "./auth-files.ts";

describe("auth file sanitization", () => {
  it("does not expose server-side token or account fields", () => {
    const file = sanitizeAuthFile(
      {
        name: "codex-person@example.com.json",
        type: "codex",
        provider: "codex",
        authIndex: 7,
        id_token: { chatgpt_account_id: "acct-secret", plan_type: "pro" },
        metadata: { account: "secret account" },
      },
      null,
    );

    assert.equal("idToken" in file, false);
    assert.equal("account" in file, false);
    assert.equal(file.planType, "pro");
    assert.equal(file.displayName, "pe*son@ex******com");
  });

  it("passes through backend success/failed counters and tolerates junk values", () => {
    const file = sanitizeAuthFile(
      {
        name: "claude-person@example.com.json",
        type: "claude",
        provider: "claude",
        authIndex: 7,
        success: "123",
        failed: 4,
      },
      null,
    );

    assert.equal(file.successCount, 123);
    assert.equal(file.failureCount, 4);

    const broken = sanitizeAuthFile(
      { name: "claude-x@example.com.json", type: "claude", authIndex: 8, success: "abc", failed: -1 },
      null,
    );
    assert.equal(broken.successCount, undefined);
    assert.equal(broken.failureCount, undefined);

    const runtime = sanitizeAuthFile(
      { name: "claude-y@example.com.json", type: "claude", authIndex: 9 },
      null,
    );
    assert.equal(runtime.successCount, undefined);
    assert.equal(runtime.failureCount, undefined);
  });

  it("builds a Z.ai auth file marker without exposing the configured api key", () => {
    const file = buildZaiAuthFile("fake-zai-key");

    assert.ok(file);
    assert.equal(file.authIndex, "server-zai");
    assert.equal(file.displayName, "Z.ai");
    assert.equal(file.type, "zai");
    assert.equal(file.provider, "zai");
    assert.equal(JSON.stringify(file).includes("fake-zai-key"), false);
    assert.equal(buildZaiAuthFile(""), null);
  });

  it("builds numbered indexes and masked names for additional Z.ai keys", () => {
    const first = buildZaiAuthFile("fake-zai-key-abcd", 0, 2);
    const second = buildZaiAuthFile("fake-zai-key-wxyz", 1, 2);

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.authIndex, "server-zai");
    assert.equal(second.authIndex, "server-zai-2");
    assert.equal(first.displayName, "Z.ai ····abcd");
    assert.equal(second.displayName, "Z.ai ····wxyz");
    assert.equal(JSON.stringify([first, second]).includes("fake-zai-key"), false);
  });

  it("builds a MiniMax auth file marker without exposing the configured api key", () => {
    const file = buildMiniMaxAuthFile("fake-minimax-key", "cn");

    assert.ok(file);
    assert.equal(file.authIndex, "server-minimax");
    assert.equal(file.displayName, "MiniMax CN");
    assert.equal(file.type, "minimax");
    assert.equal(file.provider, "minimax");
    assert.equal(JSON.stringify(file).includes("fake-minimax-key"), false);
    assert.equal(buildMiniMaxAuthFile("", "global"), null);
  });
});
