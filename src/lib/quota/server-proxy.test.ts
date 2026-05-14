import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQuotaApiCall, findRawAuthFile } from "./server-proxy.ts";
import { CODEX_USAGE_URL, GEMINI_CLI_QUOTA_URL } from "./upstream.ts";

describe("quota server proxy", () => {
  it("builds Codex calls from server-side token data and ignores client-supplied URL fields", () => {
    const call = buildQuotaApiCall(
      {
        authIndex: "42",
        provider: "codex",
        ...({ url: "http://127.0.0.1:1/secrets",
        method: "DELETE" }),
      },
      {
        name: "codex.json",
        type: "codex",
        provider: "codex",
        authIndex: "42",
        id_token: { chatgpt_account_id: "acct_123" },
      },
    );

    assert.equal(call.method, "GET");
    assert.equal(call.url, CODEX_USAGE_URL);
    assert.equal(call.header["Chatgpt-Account-Id"], "acct_123");
    assert.equal("url" in call.header, false);
  });

  it("rejects provider mismatches before building a backend call", () => {
    assert.throws(
      () =>
        buildQuotaApiCall(
          { authIndex: "42", provider: "kimi" },
          { name: "codex.json", type: "codex", provider: "codex", authIndex: "42" },
        ),
      /Provider mismatch/,
    );
  });

  it("derives Gemini project id from server-side account metadata", () => {
    const call = buildQuotaApiCall(
      { authIndex: "9", provider: "gemini-cli", action: "gemini-cli-quota" },
      {
        name: "gemini.json",
        type: "gemini-cli",
        provider: "gemini-cli",
        authIndex: "9",
        metadata: { account: "user@example.com (project-123)" },
      },
    );

    assert.equal(call.url, GEMINI_CLI_QUOTA_URL);
    assert.equal(call.data, JSON.stringify({ project: "project-123" }));
  });

  it("finds raw auth files by normalized auth index", () => {
    const file = findRawAuthFile([{ name: "a.json", auth_index: 5 }], "5");
    assert.equal(file.name, "a.json");
  });
});
