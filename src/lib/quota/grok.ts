import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData, RateLimitWindow } from "../../types/quota.ts";

import { apiFetch } from "./api-client.ts";
import {
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  normalizeNumberValue,
  normalizeStringValue,
} from "./upstream.ts";

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

type GrokBillingPeriod = {
  type?: unknown;
  start?: unknown;
  end?: unknown;
};

type GrokProductUsage = {
  product?: unknown;
  usagePercent?: unknown;
  usage_percent?: unknown;
};

type GrokBillingConfig = {
  currentPeriod?: GrokBillingPeriod | null;
  current_period?: GrokBillingPeriod | null;
  creditUsagePercent?: unknown;
  credit_usage_percent?: unknown;
  productUsage?: GrokProductUsage[] | null;
  product_usage?: GrokProductUsage[] | null;
  monthlyLimit?: unknown;
  monthly_limit?: unknown;
  used?: unknown;
  onDemandCap?: unknown;
  on_demand_cap?: unknown;
  onDemandUsed?: unknown;
  on_demand_used?: unknown;
  billingPeriodStart?: unknown;
  billing_period_start?: unknown;
  billingPeriodEnd?: unknown;
  billing_period_end?: unknown;
};

type GrokBillingPayload = {
  config?: GrokBillingConfig | null;
};

export type GrokBillingPeriodType = "weekly" | "monthly" | "unknown";

export type GrokProductUsageSummary = {
  product: string;
  usagePercent: number | null;
};

export type GrokBillingSummary = {
  periodType: GrokBillingPeriodType;
  usagePercent: number | null;
  periodStart?: string;
  periodEnd?: string;
  productUsage: GrokProductUsageSummary[];
  monthlyLimitCents: number | null;
  usedCents: number | null;
  includedUsedCents: number | null;
  onDemandCapCents: number | null;
  onDemandUsedCents: number | null;
  onDemandUsedPercent: number | null;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  usedPercent: number | null;
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

function parseGrokBillingPayload(payload: unknown): GrokBillingPayload | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return parseGrokBillingPayload(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  const record = getRecord(payload);
  return record ? (record as GrokBillingPayload) : null;
}

function grokCentValue(value: unknown) {
  const record = getRecord(value);
  if (record) return normalizeNumberValue(record.val);
  return normalizeNumberValue(value);
}

function resolveGrokPeriodType(period: GenericRecord | null): GrokBillingPeriodType {
  const rawType = normalizeStringValue(period?.type)?.toLowerCase() ?? "";
  if (rawType.includes("weekly")) return "weekly";
  if (rawType.includes("monthly")) return "monthly";
  return "unknown";
}

function normalizeGrokProductUsage(productUsage: unknown, fallbackPrefix: string): GrokProductUsageSummary[] {
  if (!Array.isArray(productUsage)) return [];

  return productUsage
    .map((item, index): GrokProductUsageSummary | null => {
      const record = getRecord(item);
      if (!record) return null;
      const product = normalizeStringValue(record.product) ?? `${fallbackPrefix} ${index + 1}`;
      const usagePercent = normalizeNumberValue(record.usagePercent ?? record.usage_percent);
      return { product, usagePercent };
    })
    .filter((item): item is GrokProductUsageSummary => item !== null);
}

const emptyGrokBillingSummary = (): GrokBillingSummary => ({
  periodType: "unknown",
  usagePercent: null,
  productUsage: [],
  monthlyLimitCents: null,
  usedCents: null,
  includedUsedCents: null,
  onDemandCapCents: null,
  onDemandUsedCents: null,
  onDemandUsedPercent: null,
  usedPercent: null,
});

export function buildGrokBillingSummary(config: unknown): GrokBillingSummary | null {
  const record = getRecord(config);
  if (!record) return null;

  const summary = emptyGrokBillingSummary();
  const currentPeriod = getRecord(record.currentPeriod ?? record.current_period);
  const periodType = resolveGrokPeriodType(currentPeriod);
  const creditUsagePercent = normalizeNumberValue(record.creditUsagePercent ?? record.credit_usage_percent);
  const periodStart =
    normalizeStringValue(currentPeriod?.start) ??
    normalizeStringValue(record.billingPeriodStart ?? record.billing_period_start) ??
    undefined;
  const periodEnd =
    normalizeStringValue(currentPeriod?.end) ??
    normalizeStringValue(record.billingPeriodEnd ?? record.billing_period_end) ??
    undefined;
  const productUsage = normalizeGrokProductUsage(record.productUsage ?? record.product_usage, "Product");

  const monthlyLimitCents = grokCentValue(record.monthlyLimit ?? record.monthly_limit);
  const usedCents = grokCentValue(record.used);
  const onDemandCapCents = grokCentValue(record.onDemandCap ?? record.on_demand_cap);
  const explicitOnDemandUsedCents = grokCentValue(record.onDemandUsed ?? record.on_demand_used);
  const billingPeriodStart =
    normalizeStringValue(record.billingPeriodStart ?? record.billing_period_start) ?? undefined;
  const billingPeriodEnd = normalizeStringValue(record.billingPeriodEnd ?? record.billing_period_end) ?? undefined;

  const includedUsedCents =
    usedCents === null
      ? null
      : monthlyLimitCents !== null && monthlyLimitCents > 0
        ? Math.min(usedCents, monthlyLimitCents)
        : usedCents;
  const derivedOnDemandUsedCents =
    usedCents !== null && monthlyLimitCents !== null ? Math.max(0, usedCents - monthlyLimitCents) : null;
  const onDemandUsedCents = explicitOnDemandUsedCents ?? derivedOnDemandUsedCents;
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : null;
  const onDemandUsedPercent =
    onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : null;

  const hasWeeklyData = creditUsagePercent !== null || periodType === "weekly" || productUsage.length > 0;
  const hasMonthlyData =
    monthlyLimitCents !== null ||
    usedCents !== null ||
    (!hasWeeklyData && (onDemandCapCents !== null || Boolean(billingPeriodEnd)));

  if (!hasWeeklyData && !hasMonthlyData) return null;

  summary.periodType = hasWeeklyData ? (periodType === "unknown" ? "weekly" : periodType) : "monthly";
  summary.usagePercent = hasWeeklyData ? creditUsagePercent : usedPercent;
  summary.periodStart = hasWeeklyData ? periodStart : billingPeriodStart;
  summary.periodEnd = hasWeeklyData ? periodEnd : billingPeriodEnd;
  summary.productUsage = productUsage;
  summary.monthlyLimitCents = monthlyLimitCents;
  summary.usedCents = usedCents;
  summary.includedUsedCents = includedUsedCents;
  summary.onDemandCapCents = onDemandCapCents;
  summary.onDemandUsedCents = onDemandUsedCents;
  summary.onDemandUsedPercent = onDemandUsedPercent;
  summary.billingPeriodStart = hasMonthlyData ? billingPeriodStart : undefined;
  summary.billingPeriodEnd = hasMonthlyData ? billingPeriodEnd : undefined;
  summary.usedPercent = usedPercent;

  return summary;
}

export function parseGrokBillingApiCallEnvelope(value: unknown): GrokBillingSummary | null {
  const envelope = normalizeApiCallEnvelope(value);
  if (envelope.statusCode < 200 || envelope.statusCode >= 300) {
    throw new Error(getApiCallErrorMessage(envelope));
  }

  const payload = parseGrokBillingPayload(envelope.body ?? envelope.bodyText);
  return buildGrokBillingSummary(payload?.config);
}

export function mergeGrokBillingSummaries(
  primary: GrokBillingSummary | null,
  fallback: GrokBillingSummary | null,
): GrokBillingSummary | null {
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    periodType: primary.periodType !== "unknown" ? primary.periodType : fallback.periodType,
    usagePercent: primary.usagePercent ?? fallback.usagePercent,
    periodStart: primary.periodStart ?? fallback.periodStart,
    periodEnd: primary.periodEnd ?? fallback.periodEnd,
    productUsage: primary.productUsage.length > 0 ? primary.productUsage : fallback.productUsage,
    monthlyLimitCents: primary.monthlyLimitCents ?? fallback.monthlyLimitCents,
    usedCents: primary.usedCents ?? fallback.usedCents,
    includedUsedCents: primary.includedUsedCents ?? fallback.includedUsedCents,
    onDemandCapCents: primary.onDemandCapCents ?? fallback.onDemandCapCents,
    onDemandUsedCents: primary.onDemandUsedCents ?? fallback.onDemandUsedCents,
    onDemandUsedPercent: primary.onDemandUsedPercent ?? fallback.onDemandUsedPercent,
    billingPeriodStart: primary.billingPeriodStart ?? fallback.billingPeriodStart,
    billingPeriodEnd: primary.billingPeriodEnd ?? fallback.billingPeriodEnd,
    usedPercent: primary.usedPercent ?? fallback.usedPercent,
  };
}

function slugValue(value: string, fallback: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function addGrokPercentWindow(
  windows: RateLimitWindow[],
  id: string,
  label: string,
  usedPercent: number | null,
  resetTime?: string,
  valueLabel?: string,
) {
  const normalizedUsed = usedPercent === null ? null : normalizePercent(usedPercent);
  windows.push({
    id,
    label,
    usedPercent: normalizedUsed ?? undefined,
    remainingPercent: normalizedUsed === null ? null : normalizePercent(100 - normalizedUsed),
    resetTime,
    valueLabel,
  });
}

const GROK_SUPERGROK_LIMIT_CENTS = 15_000;
const GROK_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

function resolveGrokPlan(summary: GrokBillingSummary, credentials?: GrokCredentials | null) {
  if (summary.monthlyLimitCents === GROK_SUPERGROK_LIMIT_CENTS) return "SuperGrok";
  if (summary.monthlyLimitCents === GROK_SUPERGROK_HEAVY_LIMIT_CENTS) return "SuperGrok Heavy";
  return getLoginMethod(credentials);
}

export function buildGrokQuotaDataFromBillingSummary(
  summary: GrokBillingSummary,
  credentials?: GrokCredentials | null,
): QuotaData {
  const windows: RateLimitWindow[] = [];
  const weeklyUsed =
    summary.periodType === "weekly" && summary.usagePercent !== null
      ? Math.max(0, Math.min(100, summary.usagePercent))
      : null;
  const hasWeeklyData =
    summary.periodType === "weekly" &&
    (weeklyUsed !== null || Boolean(summary.periodEnd) || summary.productUsage.length > 0);
  const hasMonthlyData =
    summary.monthlyLimitCents !== null || summary.usedCents !== null || Boolean(summary.billingPeriodEnd);
  const onDemandCap = summary.onDemandCapCents ?? 0;

  if (hasWeeklyData) {
    addGrokPercentWindow(windows, "grok-weekly-credits", "周度 Credits", weeklyUsed, summary.periodEnd);
  }

  summary.productUsage.forEach((item, index) => {
    addGrokPercentWindow(
      windows,
      `grok-product-${slugValue(item.product, `product-${index + 1}`)}`,
      item.product,
      item.usagePercent,
    );
  });

  if (onDemandCap > 0) {
    addGrokPercentWindow(windows, "grok-pay-as-you-go", "Pay as you go", summary.onDemandUsedPercent);
  }

  if (hasMonthlyData) {
    addGrokPercentWindow(
      windows,
      "grok-monthly-credits",
      "月度 Credits",
      summary.usedPercent,
      summary.billingPeriodEnd,
    );
  }

  if (!windows.length) {
    throw new Error("No quota data available");
  }

  const plan = resolveGrokPlan(summary, credentials);
  return {
    windows,
    planType: plan ?? undefined,
    plan_type: plan ?? undefined,
    tierLabel: plan,
  };
}

export function buildGrokQuotaDataFromApiCallResults(
  weeklyResult: PromiseSettledResult<unknown>,
  monthlyResult: PromiseSettledResult<unknown>,
): QuotaData {
  const errors: unknown[] = [];

  const readSummary = (result: PromiseSettledResult<unknown>) => {
    if (result.status === "rejected") {
      errors.push(result.reason);
      return null;
    }

    try {
      return parseGrokBillingApiCallEnvelope(result.value);
    } catch (error: unknown) {
      errors.push(error);
      return null;
    }
  };

  const summary = mergeGrokBillingSummaries(readSummary(weeklyResult), readSummary(monthlyResult));
  if (!summary) {
    const firstError = errors[0];
    throw firstError instanceof Error ? firstError : new Error(firstError ? String(firstError) : "No quota data available");
  }

  return buildGrokQuotaDataFromBillingSummary(summary);
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
