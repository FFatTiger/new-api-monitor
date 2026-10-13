import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { magpieQuotaData, readMagpieCredentialFiles } from "./magpie.ts";

describe("Magpie credential source", () => {
  it("maps enabled subscription logins into server-only credential files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "magpie-credentials-"));
    await writeFile(path.join(root, "logins.json"), JSON.stringify([
      {
        id: "474d640084fd9a24",
        agent: "antigravity",
        user: "person@gmail.com",
        plan: "Google AI Pro",
        on: true,
        auth: {
          access_token: "secret-access-token",
          refresh_token: "secret-refresh-token",
          project: "aicode-consumers",
        },
      },
      {
        id: "off-account",
        agent: "antigravity",
        user: "off@gmail.com",
        on: false,
        auth: { access_token: "disabled-token", project: "disabled-project" },
      },
      {
        id: "unsupported",
        agent: "bedrock",
        user: "other@gmail.com",
        on: true,
        auth: { access_token: "other-token" },
      },
    ]));

    const result = await readMagpieCredentialFiles(root);

    assert.deepEqual(result.files.map((file) => [file.authIndex, file.provider, file.projectId, file.planType]), [
      ["magpie-474d640084fd9a24", "antigravity", "aicode-consumers", "Google AI Pro"],
    ]);
    assert.equal(result.rawFiles[0]?.access_token, "secret-access-token");
    assert.equal(result.rawFiles[0]?.refresh_token, undefined);
    assert.equal(result.rawFiles[0]?.project_id, "aicode-consumers");
    assert.equal(JSON.stringify(result.files).includes("secret-access-token"), false);
    assert.equal(JSON.stringify(result.files).includes("secret-refresh-token"), false);
    assert.equal(JSON.stringify(result.files).includes("person@gmail.com"), false);
  });

  it("uses the quota windows Magpie already read", () => {
    const data = magpieQuotaData([
      {
        provider: "antigravity",
        user: "person@gmail.com",
        windows: [
          { pool: "Gemini", name: "7 days", used: 4.44573, resetsAt: "2026-10-17T15:34:29Z" },
          { pool: "Gemini", name: "5 hours", used: 0, resetsAt: "2026-10-13T12:17:46Z" },
          { pool: "Claude & GPT", name: "7 days", used: 0.0064, resetsAt: "2026-10-20T06:04:50Z" },
          { pool: "Claude & GPT", name: "5 hours", used: 0.0128, resetsAt: "2026-10-13T11:04:50Z" },
          { pool: "Gemini", name: "Gemini 3 Flash", family: "Gemini", used: 20, resetsAt: "2026-10-13T12:17:46Z" },
        ],
      },
      { provider: "codex", user: "other@example.com", windows: [] },
    ], "antigravity", "person@gmail.com");

    assert.equal(data.groups?.length, 4);
    assert.deepEqual(
      data.groups?.map((group) => [group.label, group.remainingFraction, group.resetTime]),
      [
        ["Gemini \u00b7 7 days", (100 - 4.44573) / 100, "2026-10-17T15:34:29Z"],
        ["Gemini \u00b7 5 hours", 1, "2026-10-13T12:17:46Z"],
        ["Claude & GPT \u00b7 7 days", (100 - 0.0064) / 100, "2026-10-20T06:04:50Z"],
        ["Claude & GPT \u00b7 5 hours", (100 - 0.0128) / 100, "2026-10-13T11:04:50Z"],
      ],
    );
  });
});
