import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseQuotaUsageGroups } from "./usage-config.ts";

describe("quota usage config", () => {
  it("parses provider channel groups from semicolon config", () => {
    assert.deepEqual(parseQuotaUsageGroups("codex=8,17,19; claude=12 ;zai=27;bad;minimax=x,24"), {
      codex: [8, 17, 19],
      claude: [12],
      zai: [27],
      minimax: [24],
    });
  });

  it("deduplicates channels and ignores invalid provider keys", () => {
    assert.deepEqual(parseQuotaUsageGroups("codex=8,8,0,-1;unknown=1;gemini-cli=44"), {
      codex: [8],
      "gemini-cli": [44],
    });
  });
});
