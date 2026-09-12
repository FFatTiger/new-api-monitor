import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchSub2ApiCredentialFiles, getSub2ApiConfig } from "./sub2api.ts";

describe("Sub2API credential source", () => {
  it("normalizes the API root and returns sanitized cards with server-only credentials", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/auth/login")) {
        return Response.json({ code: 0, data: { access_token: "admin-jwt" } });
      }
      if (url.includes("/admin/accounts?page=")) {
        return Response.json({
          code: 0,
          data: { items: [
            { id: 7, name: "person@example.com", platform: "openai", status: "active" },
            { id: 8, name: "zhipu-account", platform: "zhipu", status: "active" },
            { id: 9, name: "unsupported", platform: "bedrock", status: "active" },
          ] },
        });
      }
      if (url.includes("ids=7")) {
        return Response.json({ code: 0, data: { accounts: [{ credentials: {
          access_token: "secret-access-token", id_token: "header.payload.sig", chatgpt_account_id: "acct-7",
        } }] } });
      }
      if (url.includes("ids=8")) {
        return Response.json({ code: 0, data: { accounts: [{ credentials: { api_key: "secret-zhipu-key" } }] } });
      }
      throw new Error(`unexpected ${url}`);
    };

    const config = getSub2ApiConfig({
      SUB2API_BASE_URL: "http://sub2api:8080/",
      SUB2API_EMAIL: "monitor@example.com",
      SUB2API_PASSWORD: "password",
    });
    const result = await fetchSub2ApiCredentialFiles(config, fetchImpl as typeof fetch);

    assert.deepEqual(result.files.map((file) => [file.authIndex, file.provider, file.planType]), [
      ["sub2api-account-7", "codex", null],
      ["sub2api-account-8", "zai", null],
    ]);
    assert.equal(result.rawFiles[0]?.access_token, "secret-access-token");
    assert.equal(JSON.stringify(result.files).includes("secret-access-token"), false);
    assert.equal(JSON.stringify(result.files).includes("secret-zhipu-key"), false);
    assert.ok(calls.every((url) => url.startsWith("http://sub2api:8080/api/v1/")));

    const custom = getSub2ApiConfig({
      SUB2API_BASE_URL: "http://sub2api:8080",
      SUB2API_EMAIL: "monitor@example.com",
      SUB2API_PASSWORD: "password",
      SUB2API_PROVIDER_MAP: "bedrock=zai",
    });
    assert.equal(custom.providerMap.bedrock, "zai");
  });
});
