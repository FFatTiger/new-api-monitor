import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData, RateLimitWindow } from "../../types/quota.ts";

import { apiFetch } from "./api-client.ts";
import { normalizeNumberValue, normalizeStringValue } from "./upstream.ts";

export const ZAI_AUTH_INDEX = "server-zai";
export const ZAI_USAGE_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

export type ZaiEnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Parses a comma separated Z.ai key list (Chinese full-width comma tolerated).
 * Empty segments are dropped and duplicate keys keep their first position.
 */
export function parseZaiApiKeysValue(value: unknown): string[] {
  if (typeof value !== "string") return [];

  const seen = new Set<string>();
  const keys: string[] = [];

  value
    .split(",")
    .flatMap((part) => part.split("\uFF0C"))
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });

  return keys;
}

/**
 * ZAI_API_KEYS (comma separated, multiple cards) wins; otherwise the legacy
 * single ZAI_API_KEY / ZAI_API_TOKEN env is kept as a one-key list.
 */
export function getZaiApiKeysFromEnv(env: ZaiEnvSource = process.env): string[] {
  const multi = parseZaiApiKeysValue(env.ZAI_API_KEYS);
  if (multi.length > 0) return multi;

  const single = (env.ZAI_API_KEY || env.ZAI_API_TOKEN || "").trim();
  return single ? [single] : [];
}

/**
 * Slot 0 keeps the historical "server-zai" index so existing deployments keep
 * their quota history; additional keys get "server-zai-2", "server-zai-3", ...
 */
export function buildZaiAuthIndex(slot: number): string {
  return slot <= 0 ? ZAI_AUTH_INDEX : `${ZAI_AUTH_INDEX}-${slot + 1}`;
}

export function getZaiSlotFromAuthIndex(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (raw === ZAI_AUTH_INDEX) return 0;

  const match = /^server-zai-([2-9][0-9]*)$/.exec(raw);
  if (!match) return null;

  return Number(match[1]) - 1;
}

export function getZaiKeyForAuthIndex(authIndex: unknown, keys: string[]): string | null {
  const slot = getZaiSlotFromAuthIndex(authIndex);
  if (slot === null || slot >= keys.length) return null;
  return keys[slot] ?? null;
}

/** Single key keeps the plain "Z.ai" card; extra keys are masked for identification. */
export function buildZaiDisplayName(apiKey: string, total: number): string {
  if (total <= 1) return "Z.ai";
  return `Z.ai ····${apiKey.slice(-4)}`;
}

type ZaiLimit = {
  type?: unknown;
  unit?: unknown;
  number?: unknown;
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
  return clampPercent(numberValue);
}

function normalizeZaiLimitId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toZaiLimitLabel(value: string, limit: ZaiLimit) {
  const unit = normalizeNumberValue(limit.unit);
  const number = normalizeNumberValue(limit.number);
  if (unit === 3 && number !== null) return `${number}小时额度`;
  if (unit === 5 && number === 1) return "周额度";

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
  return getZaiSlotFromAuthIndex(value) !== null;
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
      label: toZaiLimitLabel(type, limit),
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
