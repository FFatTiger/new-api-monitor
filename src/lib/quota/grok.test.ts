import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGrokQuotaData,
  extractGrokCredentials,
  fetchGrokQuotaFromAuthContent,
  GROK_USAGE_URL,
  parseGrokGrpcWebBillingResponse,
  parseGrokRpcBillingResponse,
} from "./grok.ts";

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function encodeVarint(value: number) {
  const bytes: number[] = [];
  let next = value;
  while (next >= 0x80) {
    bytes.push((next & 0x7f) | 0x80);
    next = Math.floor(next / 128);
  }
  bytes.push(next);
  return new Uint8Array(bytes);
}

function varintField(fieldNumber: number, value: number) {
  return concat(new Uint8Array([(fieldNumber << 3) | 0]), encodeVarint(value));
}

function lengthDelimitedField(fieldNumber: number, payload: Uint8Array) {
  return concat(new Uint8Array([(fieldNumber << 3) | 2]), encodeVarint(payload.length), payload);
}

function fixed32Field(fieldNumber: number, value: number) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return concat(new Uint8Array([(fieldNumber << 3) | 5]), new Uint8Array(buffer));
}

function grpcWebFrame(payload: Uint8Array, flags = 0) {
  return concat(
    new Uint8Array([
      flags,
      (payload.length >> 24) & 0xff,
      (payload.length >> 16) & 0xff,
      (payload.length >> 8) & 0xff,
      payload.length & 0xff,
    ]),
    payload,
  );
}

function usageFrame(usedPercent = 42.5, resetEpoch = 1_800_000_000) {
  const inner = concat(
    fixed32Field(1, usedPercent),
    lengthDelimitedField(5, varintField(1, resetEpoch)),
  );
  return grpcWebFrame(lengthDelimitedField(1, inner));
}

describe("Grok quota parsing", () => {
  it("selects the OIDC Grok auth entry and keeps only server-side credentials", () => {
    const credentials = extractGrokCredentials({
      "https://accounts.x.ai/sign-in": {
        key: "legacy-token",
        email: "legacy@example.com",
        auth_mode: "browser",
      },
      "https://auth.x.ai::profile": {
        key: "oidc-token",
        email: "User@Example.COM",
        team_id: "team-1",
        user_id: "user-1",
        auth_mode: "oidc",
        expires_at: "2026-06-01T00:00:00Z",
      },
    });

    assert.equal(credentials?.accessToken, "oidc-token");
    assert.equal(credentials?.email, "User@Example.COM");
    assert.equal(credentials?.teamId, "team-1");
    assert.equal(credentials?.authMode, "oidc");
  });

  it("parses the upstream x.ai/billing JSON structure", () => {
    const usage = parseGrokRpcBillingResponse({
      billingCycle: {
        billingPeriodStart: "2026-05-01T00:00:00Z",
        billingPeriodEnd: "2026-06-01T00:00:00Z",
      },
      monthlyLimit: { val: 10_000 },
      usage: {
        totalUsed: { val: 2_500 },
      },
    });

    assert.deepEqual(usage, {
      source: "x.ai/billing",
      usedPercent: 25,
      remainingPercent: 75,
      resetTime: "2026-06-01T00:00:00Z",
    });
  });

  it("parses the grok.com gRPC-web billing response percent and preferred reset", () => {
    const usage = parseGrokGrpcWebBillingResponse(usageFrame(42.5), {
      now: new Date(1_700_000_000 * 1000),
    });

    assert.equal(usage.source, "grok.com gRPC-web");
    assert.equal(usage.usedPercent, 42.5);
    assert.equal(usage.remainingPercent, 57.5);
    assert.equal(usage.resetTime, "2027-01-15T08:00:00.000Z");
  });

  it("treats a response with a future reset marker and no usage as 0% used", () => {
    const inner = concat(
      lengthDelimitedField(5, varintField(1, 1_800_000_000)),
      lengthDelimitedField(6, varintField(1, 1)),
    );
    const usage = parseGrokGrpcWebBillingResponse(grpcWebFrame(lengthDelimitedField(1, inner)), {
      now: new Date(1_700_000_000 * 1000),
    });

    assert.equal(usage.usedPercent, 0);
    assert.equal(usage.remainingPercent, 100);
  });

  it("rejects non-zero gRPC trailer statuses", () => {
    const trailer = grpcWebFrame(new TextEncoder().encode("grpc-status: 13\r\ngrpc-message: bad%20status\r\n"), 0x80);

    assert.throws(
      () => parseGrokGrpcWebBillingResponse(trailer),
      /gRPC status 13: bad status/,
    );
  });

  it("builds quota windows from a normalized Grok usage result", () => {
    const data = buildGrokQuotaData(
      {
        source: "x.ai/billing",
        usedPercent: 80,
        remainingPercent: 20,
        resetTime: "2026-06-01T00:00:00Z",
      },
      {
        accessToken: "secret",
        scope: "https://auth.x.ai::profile",
        authMode: "oidc",
        email: "user@example.com",
        teamId: "team",
        userId: "user",
        expiresAt: null,
      },
    );

    assert.equal(data.tierLabel, "SuperGrok");
    assert.deepEqual(data.windows, [
      {
        id: "grok-credits",
        label: "Credits",
        usedPercent: 80,
        remainingPercent: 20,
        resetTime: "2026-06-01T00:00:00Z",
        valueLabel: "20%",
      },
    ]);
    assert.equal(JSON.stringify(data).includes("secret"), false);
    assert.equal(JSON.stringify(data).includes("user@example.com"), false);
  });

  it("fetches Grok quota with the bearer from auth.json without exposing it", async () => {
    const payload = usageFrame(12.5);
    let capturedAuthorization = "";

    const data = await fetchGrokQuotaFromAuthContent(
      {
        "https://auth.x.ai::profile": {
          key: "grok-token",
          auth_mode: "oidc",
        },
      },
      async (url, init) => {
        assert.equal(url, GROK_USAGE_URL);
        capturedAuthorization = (init?.headers as Record<string, string>).Authorization;
        assert.deepEqual(Array.from(init?.body as Uint8Array), [0, 0, 0, 0, 0]);
        return new Response(payload);
      },
    );

    assert.equal(capturedAuthorization, "Bearer grok-token");
    assert.equal(data.windows?.[0]?.remainingPercent, 87.5);
    assert.equal(JSON.stringify(data).includes("grok-token"), false);
  });
});
