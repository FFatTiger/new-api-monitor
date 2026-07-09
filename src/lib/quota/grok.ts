import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData, RateLimitWindow } from "../../types/quota.ts";

import { apiFetch } from "./api-client.ts";
import { normalizeNumberValue, normalizeStringValue } from "./upstream.ts";

export const GROK_USAGE_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";

const GROK_GRPC_WEB_BODY = new Uint8Array([0, 0, 0, 0, 0]);
const GROK_OIDC_SCOPE_PREFIX = "https://auth.x.ai::";
const GROK_LEGACY_SCOPE = "https://accounts.x.ai/sign-in";

type GenericRecord = Record<string, unknown>;

type GrokAuthEntry = {
  key?: unknown;
  auth_mode?: unknown;
  email?: unknown;
  team_id?: unknown;
  user_id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  expires_at?: unknown;
};

export type GrokCredentials = {
  accessToken: string;
  scope: string;
  authMode: string | null;
  email: string | null;
  teamId: string | null;
  userId: string | null;
  expiresAt: string | null;
};

export type GrokBillingUsage = {
  source: "grok.com gRPC-web" | "x.ai/billing";
  usedPercent: number;
  remainingPercent: number;
  resetTime?: string;
};

type ProtoScan = {
  varints: Array<{ path: number[]; value: number }>;
  fixed32: Array<{ path: number[]; value: number; order: number }>;
};

function getRecord(value: unknown): GenericRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as GenericRecord) : null;
}

function normalizePercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function authSelection(scope: string, entry: GrokAuthEntry): GrokCredentials | null {
  const accessToken = normalizeStringValue(entry.key);
  if (!accessToken) return null;

  return {
    accessToken,
    scope,
    authMode: normalizeStringValue(entry.auth_mode),
    email: normalizeStringValue(entry.email),
    teamId: normalizeStringValue(entry.team_id),
    userId: normalizeStringValue(entry.user_id),
    expiresAt: normalizeStringValue(entry.expires_at),
  };
}

export function extractGrokCredentials(authContent: unknown): GrokCredentials | null {
  const root = getRecord(authContent);
  if (!root) return null;

  if (normalizeStringValue(root.key)) {
    return authSelection("direct", root as GrokAuthEntry);
  }

  let oidc: { scope: string; entry: GrokAuthEntry } | null = null;
  let legacy: { scope: string; entry: GrokAuthEntry } | null = null;
  let fallback: { scope: string; entry: GrokAuthEntry } | null = null;

  for (const [scope, value] of Object.entries(root)) {
    const entry = getRecord(value) as GrokAuthEntry | null;
    if (!entry || !normalizeStringValue(entry.key)) continue;

    if (scope.startsWith(GROK_OIDC_SCOPE_PREFIX)) {
      oidc = { scope, entry };
    } else if (scope === GROK_LEGACY_SCOPE || scope.includes("/sign-in")) {
      legacy = { scope, entry };
    } else if (!fallback) {
      fallback = { scope, entry };
    }
  }

  const selected = oidc || legacy || fallback;
  return selected ? authSelection(selected.scope, selected.entry) : null;
}

function getLoginMethod(credentials?: GrokCredentials | null) {
  const authMode = credentials?.authMode?.trim();
  if (!authMode) return null;
  return authMode.toLowerCase() === "oidc" ? "SuperGrok" : authMode;
}

function grpcWebDataFrames(data: Uint8Array) {
  const frames: Uint8Array[] = [];
  let index = 0;

  while (index + 5 <= data.length) {
    const flags = data[index];
    const length = data[index + 1] * 2 ** 24 + data[index + 2] * 2 ** 16 + data[index + 3] * 2 ** 8 + data[index + 4];
    const start = index + 5;
    const end = start + length;
    if (length < 0 || end > data.length) return [];

    if ((flags & 0x80) === 0) {
      frames.push(data.subarray(start, end));
    }
    index = end;
  }

  return frames;
}

function grpcWebTrailerFields(data: Uint8Array) {
  const fields: Record<string, string> = {};
  let index = 0;
  const decoder = new TextDecoder();

  while (index + 5 <= data.length) {
    const flags = data[index];
    const length = data[index + 1] * 2 ** 24 + data[index + 2] * 2 ** 16 + data[index + 3] * 2 ** 8 + data[index + 4];
    const start = index + 5;
    const end = start + length;
    if (length < 0 || end > data.length) break;

    if ((flags & 0x80) !== 0) {
      const text = decoder.decode(data.subarray(start, end));
      text.split(/\r?\n/).forEach((line) => {
        const separator = line.indexOf(":");
        if (separator <= 0) return;
        fields[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      });
    }

    index = end;
  }

  return fields;
}

export function validateGrokGrpcStatus(data: Uint8Array, headers: Record<string, string> = {}) {
  const headerStatus = headers["grpc-status"];
  if (headerStatus && headerStatus !== "0") {
    const message = decodeGrpcMessage(headers["grpc-message"] || "");
    throw new Error(`gRPC status ${headerStatus}${message ? `: ${message}` : ""}`);
  }

  const trailers = grpcWebTrailerFields(data);
  const trailerStatus = trailers["grpc-status"];
  if (trailerStatus && trailerStatus !== "0") {
    const message = decodeGrpcMessage(trailers["grpc-message"] || "");
    throw new Error(`gRPC status ${trailerStatus}${message ? `: ${message}` : ""}`);
  }
}

function looksLikeProtobufPayload(data: Uint8Array) {
  if (!data.length) return false;
  const field = data[0] >> 3;
  const wire = data[0] & 0x07;
  return field > 0 && (wire === 0 || wire === 1 || wire === 2 || wire === 5);
}

function readVarint(data: Uint8Array, index: number): { value: number; nextIndex: number } | null {
  let value = 0;
  let shift = 0;
  let nextIndex = index;

  while (nextIndex < data.length && shift < 53) {
    const byte = data[nextIndex];
    nextIndex += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, nextIndex };
    shift += 7;
  }

  return null;
}

function decodeGrpcMessage(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function scanProtobuf(data: Uint8Array, depth = 0, path: number[] = [], order = 0): { scan: ProtoScan; order: number } {
  const scan: ProtoScan = { varints: [], fixed32: [] };
  let index = 0;
  let nextOrder = order;

  while (index < data.length) {
    const fieldStart = index;
    const keyResult = readVarint(data, index);
    if (!keyResult || keyResult.value === 0) {
      index = fieldStart + 1;
      continue;
    }

    index = keyResult.nextIndex;
    const fieldNumber = Math.floor(keyResult.value / 8);
    const wireType = keyResult.value & 0x07;
    const fieldPath = [...path, fieldNumber];

    if (wireType === 0) {
      const valueResult = readVarint(data, index);
      if (!valueResult) {
        index = fieldStart + 1;
        continue;
      }
      index = valueResult.nextIndex;
      scan.varints.push({ path: fieldPath, value: valueResult.value });
      continue;
    }

    if (wireType === 1) {
      index = index + 8 <= data.length ? index + 8 : fieldStart + 1;
      continue;
    }

    if (wireType === 2) {
      const lengthResult = readVarint(data, index);
      if (!lengthResult || lengthResult.value > data.length - lengthResult.nextIndex) {
        index = fieldStart + 1;
        continue;
      }

      index = lengthResult.nextIndex;
      const sub = data.subarray(index, index + lengthResult.value);
      if (depth < 4) {
        const nested = scanProtobuf(sub, depth + 1, fieldPath, nextOrder);
        scan.varints.push(...nested.scan.varints);
        scan.fixed32.push(...nested.scan.fixed32);
        nextOrder = nested.order;
      }
      index += lengthResult.value;
      continue;
    }

    if (wireType === 5) {
      if (index + 4 > data.length) {
        index = fieldStart + 1;
        continue;
      }
      const value = new DataView(data.buffer, data.byteOffset + index, 4).getFloat32(0, true);
      if (Number.isFinite(value)) {
        scan.fixed32.push({ path: fieldPath, value, order: nextOrder });
        nextOrder += 1;
      }
      index += 4;
      continue;
    }

    index = fieldStart + 1;
  }

  return { scan, order: nextOrder };
}

function mergeScans(scans: ProtoScan[]) {
  return scans.reduce<ProtoScan>(
    (merged, scan) => {
      merged.varints.push(...scan.varints);
      merged.fixed32.push(...scan.fixed32);
      return merged;
    },
    { varints: [], fixed32: [] },
  );
}

function pathEquals(path: number[], expected: number[]) {
  return path.length === expected.length && path.every((value, index) => value === expected[index]);
}

function toIsoResetTime(value: Date | null) {
  return value ? value.toISOString() : undefined;
}

export function parseGrokGrpcWebBillingResponse(
  data: Uint8Array,
  options: { now?: Date; headers?: Record<string, string> } = {},
): GrokBillingUsage {
  validateGrokGrpcStatus(data, options.headers || {});

  let payloads = grpcWebDataFrames(data);
  if (!payloads.length && looksLikeProtobufPayload(data)) {
    payloads = [data];
  }
  if (!payloads.length) throw new Error("Grok billing response contained no protobuf data frames");

  let order = 0;
  const scans = payloads.map((payload) => {
    const result = scanProtobuf(payload, 0, [], order);
    order = result.order;
    return result.scan;
  });
  const merged = mergeScans(scans);
  const now = options.now || new Date();

  const usageCandidates = merged.fixed32
    .filter((field) => field.path.at(-1) === 1 && field.value >= 0 && field.value <= 100)
    .sort((a, b) => a.path.length - b.path.length || a.order - b.order);
  const preferredUsageCandidates = usageCandidates.filter((field) => pathEquals(field.path, [1, 1]));
  const orderedUsageCandidates = preferredUsageCandidates.length ? preferredUsageCandidates : usageCandidates;

  const resetCandidates = merged.varints
    .filter((field) => field.value >= 1_700_000_000 && field.value <= 2_100_000_000)
    .map((field) => ({ path: field.path, date: new Date(field.value * 1000) }))
    .filter((field) => field.date > now);
  const preferredResets = resetCandidates.filter((field) => pathEquals(field.path, [1, 5, 1])).map((field) => field.date);
  const allResets = resetCandidates.map((field) => field.date);
  const resetAt = (preferredResets.length ? preferredResets : allResets).sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const hasLocalResetMarker = merged.varints.some((field) => pathEquals(field.path.slice(0, 2), [1, 6]));

  let usedPercent = orderedUsageCandidates[0]?.value;
  if (usedPercent === undefined && merged.fixed32.length === 0 && resetAt && hasLocalResetMarker) {
    usedPercent = 0;
  }
  if (usedPercent === undefined) throw new Error("Could not parse Grok billing usage");

  return {
    source: "grok.com gRPC-web",
    usedPercent: normalizePercent(usedPercent),
    remainingPercent: normalizePercent(100 - usedPercent),
    resetTime: toIsoResetTime(resetAt),
  };
}

function centValue(value: unknown) {
  const record = getRecord(value);
  return normalizeNumberValue(record?.val);
}

export function parseGrokRpcBillingResponse(payload: unknown): GrokBillingUsage {
  const record = getRecord(payload);
  if (!record) throw new Error("Grok billing response is not an object");

  const usage = getRecord(record.usage);
  const billingCycle = getRecord(record.billingCycle);
  const monthlyLimit = centValue(record.monthlyLimit);
  const totalUsed = centValue(usage?.totalUsed);

  if (monthlyLimit === null || monthlyLimit <= 0 || totalUsed === null) {
    throw new Error("Could not parse Grok billing usage");
  }

  const usedPercent = normalizePercent((totalUsed / monthlyLimit) * 100);
  const resetTime = normalizeStringValue(billingCycle?.billingPeriodEnd) || undefined;

  return {
    source: "x.ai/billing",
    usedPercent,
    remainingPercent: normalizePercent(100 - usedPercent),
    resetTime,
  };
}

function grokWindowLabel(usage: GrokBillingUsage) {
  if (!usage.resetTime) return "Credits";

  const resetTime = new Date(usage.resetTime).getTime();
  if (Number.isNaN(resetTime)) return "Credits";

  const remainingDays = Math.round((resetTime - Date.now()) / 86_400_000);
  if (remainingDays > 20 && remainingDays < 45) return "月度 Credits";
  if (remainingDays > 4 && remainingDays < 10) return "周度 Credits";
  return "Credits";
}

export function buildGrokQuotaData(usage: GrokBillingUsage, credentials?: GrokCredentials | null): QuotaData {
  const windowData: RateLimitWindow = {
    id: "grok-credits",
    label: grokWindowLabel(usage),
    usedPercent: usage.usedPercent,
    remainingPercent: usage.remainingPercent,
    resetTime: usage.resetTime,
    valueLabel: `${Math.round(usage.remainingPercent)}%`,
  };
  const loginMethod = getLoginMethod(credentials);

  return {
    windows: [windowData],
    planType: loginMethod ?? undefined,
    plan_type: loginMethod ?? undefined,
    tierLabel: loginMethod,
  };
}

function grokRequestHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Origin: "https://grok.com",
    Referer: "https://grok.com/?_s=usage",
    Accept: "*/*",
    "Content-Type": "application/grpc-web+proto",
    "x-grpc-web": "1",
    "x-user-agent": "connect-es/2.1.1",
    "User-Agent": "new-api-monitor Grok quota",
  };
}

function responseHeadersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

export async function fetchGrokQuotaFromAuthContent(authContent: unknown, fetchImpl: typeof fetch = fetch): Promise<QuotaData> {
  const credentials = extractGrokCredentials(authContent);
  if (!credentials?.accessToken) {
    throw new Error("Missing Grok auth token");
  }

  const response = await fetchImpl(GROK_USAGE_URL, {
    method: "POST",
    headers: grokRequestHeaders(credentials.accessToken),
    body: GROK_GRPC_WEB_BODY,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Grok quota request failed: HTTP ${response.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
  }

  const body = new Uint8Array(await response.arrayBuffer());
  const usage = parseGrokGrpcWebBillingResponse(body, { headers: responseHeadersToRecord(response.headers) });
  return buildGrokQuotaData(usage, credentials);
}

export async function fetchGrokQuota(file: AuthFile) {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Grok");
  }

  const response = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex,
      provider: "xai",
    }),
  });

  const data = (await response.json()) as QuotaData;
  if (!data.windows?.length) {
    throw new Error("No quota data available");
  }

  return data;
}
