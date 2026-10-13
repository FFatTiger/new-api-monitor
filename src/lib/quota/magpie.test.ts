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
          { pool: "Gemini", name: "7 days", used: 4.44573, resetSecs: 604_800, resetsAt: "2026-10-17T15:34:29Z" },
          { pool: "Gemini", name: "5 hours", used: 0, resetSecs: 18_000, resetsAt: "2026-10-13T12:17:46Z" },
          { pool: "Claude & GPT", name: "7 days", used: 0.0064, resetSecs: 604_800, resetsAt: "2026-10-20T06:04:50Z" },
          { pool: "Claude & GPT", name: "5 hours", used: 0.0128, resetSecs: 18_000, resetsAt: "2026-10-13T11:04:50Z" },
          { pool: "Gemini", name: "Gemini 3 Flash", family: "Gemini", used: 20, resetSecs: 18_000, resetsAt: "2026-10-13T12:17:46Z" },
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

  it("keeps model windows when an account has no shared pool", () => {
    const data = magpieQuotaData([
      {
        provider: "antigravity",
        user: "person@gmail.com",
        windows: [
          { family: "Claude", name: "Claude Opus 4.6 (Thinking)", used: 12, resetSecs: 17_999, resetsAt: "2026-10-13T19:01:53Z" },
          { family: "Gemini", name: "Gemini 3 Flash", used: 0, resetSecs: 17_999, resetsAt: "2026-10-13T19:01:53Z" },
        ],
      },
    ], "antigravity", "person@gmail.com");

    assert.deepEqual(
      data.groups?.map((group) => [group.label, group.remainingFraction]),
      [
        ["Claude Opus 4.6 (Thinking)", 0.88],
        ["Gemini 3 Flash", 1],
      ],
    );
  });

  it("keeps a model window whose span has no shared pool window", () => {
    const data = magpieQuotaData([
      {
        provider: "antigravity",
        user: "person@gmail.com",
        windows: [
          { pool: "Gemini", family: "Gemini", name: "Gemini 3 Flash", used: 8, resetSecs: 17_999 },
          { pool: "Gemini", name: "7 days", used: 4, resetSecs: 700_000 },
        ],
      },
    ], "antigravity", "person@gmail.com");

    assert.deepEqual(
      data.groups?.map((group) => group.label),
      ["Gemini 3 Flash", "Gemini \u00b7 7 days"],
    );
  });
});
