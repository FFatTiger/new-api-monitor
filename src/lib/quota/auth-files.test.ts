import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeAuthFile } from "./auth-files.ts";

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
});
