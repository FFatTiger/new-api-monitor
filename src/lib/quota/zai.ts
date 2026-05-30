import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData, RateLimitWindow } from "../../types/quota.ts";

import { apiFetch } from "./api-client.ts";
import { normalizeNumberValue, normalizeStringValue } from "./upstream.ts";

export const ZAI_AUTH_INDEX = "server-zai";
export const ZAI_USAGE_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

type ZaiLimit = {
  type?: unknown;
  percentage?: unknown;
  nextResetTime?: unknown;
};

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, roundPercent(value)));
}

function normalizeZaiUsagePercent(value: unknown): number | null {
  const numberValue = normalizeNumberValue(value);
  if (numberValue === null) return null;
  return clampPercent(numberValue >= 0 && numberValue <= 1 ? numberValue * 100 : numberValue);
}

function normalizeZaiLimitId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toZaiLimitLabel(value: string) {
  const words = value.replace(/_LIMIT$/i, "").split(/[_\s-]+/).filter(Boolean);
  if (!words.length) return "Limit";

  return words
    .map((word) => {
      const lower = word.toLowerCase();
      return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function extractZaiLimits(payload: unknown): ZaiLimit[] {
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : {};
  const limits = data.limits || record.limits;
  return Array.isArray(limits) ? limits : [];
}

function getZaiLevel(payload: unknown) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : {};
  return normalizeStringValue(data.level ?? record.level)?.toLowerCase() ?? null;
}

function getZaiLevelLabel(level: string | null) {
  if (!level) return null;
  return `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;
}

export function isZaiAuthIndex(value: unknown) {
  return String(value ?? "").trim() === ZAI_AUTH_INDEX;
}

export function buildZaiQuotaWindows(payload: unknown): RateLimitWindow[] {
  const windows: RateLimitWindow[] = [];

  extractZaiLimits(payload).forEach((limit) => {
    const type = normalizeStringValue(limit.type) ?? "LIMIT";
    const usedPercent = normalizeZaiUsagePercent(limit.percentage);
    if (usedPercent === null) return;

    const id = normalizeZaiLimitId(type) || "limit";
    windows.push({
      id,
      label: toZaiLimitLabel(type),
      usedPercent,
      remainingPercent: clampPercent(100 - usedPercent),
      resetTime:
        typeof limit.nextResetTime === "number" || typeof limit.nextResetTime === "string"
          ? limit.nextResetTime
          : undefined,
    });
  });

  return windows.sort((a, b) => {
    if (a.id === "tokens-limit") return -1;
    if (b.id === "tokens-limit") return 1;
    return a.label?.localeCompare(b.label || "") || 0;
  });
}

export function buildZaiQuotaData(payload: unknown): QuotaData {
  const level = getZaiLevel(payload);

  return {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}),
    windows: buildZaiQuotaWindows(payload),
    planType: level ?? undefined,
    plan_type: level ?? undefined,
    tierLabel: getZaiLevelLabel(level),
  };
}

export async function fetchZaiQuota(file: AuthFile) {
  if (!isZaiAuthIndex(file.authIndex)) {
    throw new Error("Missing Z.ai auth index");
  }

  const response = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex: file.authIndex,
      provider: "zai",
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.success === false) {
    throw new Error(normalizeStringValue(payload.msg) || "Z.ai quota request failed");
  }

  const data = buildZaiQuotaData(payload);
  if (!data.windows?.length) {
    throw new Error("No quota data available");
  }

  return data;
}
