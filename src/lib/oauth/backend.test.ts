import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOAuthStartBackendRequest,
  getCallbackBackendProvider,
  hasValidOAuthAccessKey,
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

  it("validates the dedicated OAuth page key", () => {
    assert.equal(hasValidOAuthAccessKey("secret", "secret"), true);
    assert.equal(hasValidOAuthAccessKey("wrong", "secret"), false);
    assert.equal(hasValidOAuthAccessKey("secret", ""), false);
  });
});
