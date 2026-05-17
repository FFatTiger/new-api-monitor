import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOAuthStartBackendRequest,
  getCallbackBackendProvider,
  getPublicBackendErrorMessage,
  getVertexCredentialFileError,
  hasOAuthBackendCredentials,
  isCallbackSupportedProvider,
  isOAuthProvider,
} from "./backend.ts";

describe("oauth backend compatibility", () => {
  it("builds xAI Grok auth URL requests with web UI callback support", () => {
    const request = buildOAuthStartBackendRequest("https://api.example.test/", "xai", undefined);

    assert.equal(request.url, "https://api.example.test/xai-auth-url?is_webui=true");
  });

  it("accepts Grok as an xAI provider alias", () => {
    assert.equal(isOAuthProvider("grok"), true);
    assert.equal(getCallbackBackendProvider("grok"), "xai");
  });

  it("keeps Gemini CLI callback provider compatible with upstream backend", () => {
    assert.equal(getCallbackBackendProvider("gemini-cli"), "gemini");
  });

  it("passes optional Gemini CLI project id only to the Gemini auth URL request", () => {
    const request = buildOAuthStartBackendRequest("https://api.example.test", "gemini-cli", "project-123");

    assert.equal(request.url, "https://api.example.test/gemini-cli-auth-url?is_webui=true&project_id=project-123");
  });

  it("treats Kimi as start-only device flow provider", () => {
    const request = buildOAuthStartBackendRequest("https://api.example.test", "kimi", "ignored-project");

    assert.equal(request.url, "https://api.example.test/kimi-auth-url");
    assert.equal(isCallbackSupportedProvider("kimi"), false);
  });

  it("requires only server-side backend credentials for OAuth proxy routes", () => {
    assert.equal(hasOAuthBackendCredentials("https://api.example.test", "management-key"), true);
    assert.equal(hasOAuthBackendCredentials("", "management-key"), false);
    assert.equal(hasOAuthBackendCredentials("https://api.example.test", ""), false);
  });

  it("keeps backend error details server-side", () => {
    assert.equal(getPublicBackendErrorMessage(500, "stack with API_MANAGEMENT_KEY=secret"), "Backend request failed");
  });

  it("limits Vertex credential uploads to small JSON files", () => {
    assert.equal(getVertexCredentialFileError({ name: "service-account.json", size: 16_384 }), null);
    assert.equal(getVertexCredentialFileError({ name: "service-account.txt", size: 16_384 }), "Only JSON files are allowed");
    assert.equal(getVertexCredentialFileError({ name: "service-account.json", size: 300_000 }), "File is too large");
  });
});
