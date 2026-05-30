import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData, RateLimitWindow } from "../../types/quota.ts";

import { apiFetch } from "./api-client.ts";
import { normalizeNumberValue, normalizeStringValue } from "./upstream.ts";

export type MiniMaxEndpointRegion = "global" | "cn";
export type MiniMaxEndpointMode = MiniMaxEndpointRegion | "auto";

export const MINIMAX_AUTH_INDEX = "server-minimax";
export const MINIMAX_GLOBAL_USAGE_URL = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";
export const MINIMAX_CN_USAGE_URL = "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains";

type MiniMaxEndpointCandidate = {
  region: MiniMaxEndpointRegion;
  url: string;
};

type MiniMaxRemain = {
  model_name?: unknown;
  category?: unknown;
  display_name?: unknown;
  current_interval_total_count?: unknown;
  current_interval_usage_count?: unknown;
  remains_time?: unknown;
  end_time?: unknown;
};

const MINIMAX_REMAINS_PATH = "/v1/api/openplatform/coding_plan/remains";

const planByRegion: Record<MiniMaxEndpointRegion, Record<number, string>> = {
  cn: {
    40: "starter",
    100: "plus",
    300: "max",
    2000: "ultra",
  },
  global: {
    100: "starter",
    300: "plus",
    1000: "max",
    2000: "ultra",
  },
};

function titleCase(value: string | null) {
  if (!value) return null;
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, roundOne(value)));
}

function promptCount(value: unknown) {
  const raw = normalizeNumberValue(value);
  return raw === null ? null : raw / 15;
}

function formatPrompt(value: number) {
  const rounded = roundOne(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getMiniMaxRemains(payload: unknown, key: "model_remains" | "category_remains"): MiniMaxRemain[] {
  const remains = getRecord(payload)[key];
  return Array.isArray(remains) ? remains : [];
}

function getMiniMaxResetTime(item: MiniMaxRemain) {
  const endTime = normalizeNumberValue(item.end_time);
  if (endTime !== null) return endTime;

  const remainsTime = normalizeNumberValue(item.remains_time);
  return remainsTime === null ? undefined : Date.now() + remainsTime * 1000;
}

function toMiniMaxWindow(item: MiniMaxRemain, fallbackLabel: string): RateLimitWindow | null {
  const totalPrompt = promptCount(item.current_interval_total_count);
  const remainingPrompt = promptCount(item.current_interval_usage_count);
  if (totalPrompt === null || remainingPrompt === null || totalPrompt <= 0) return null;

  const safeRemainingPrompt = Math.max(0, Math.min(totalPrompt, remainingPrompt));
  const usedPrompt = Math.max(0, totalPrompt - safeRemainingPrompt);
  const remainingPercent = clampPercent((safeRemainingPrompt / totalPrompt) * 100);
  const usedPercent = clampPercent((usedPrompt / totalPrompt) * 100);
  const label =
    normalizeStringValue(item.model_name) ||
    normalizeStringValue(item.display_name) ||
    normalizeStringValue(item.category) ||
    fallbackLabel;

  return {
    id: label
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    label,
    usedPercent,
    remainingPercent,
    resetTime: getMiniMaxResetTime(item),
    valueLabel: `${formatPrompt(safeRemainingPrompt)}/${formatPrompt(totalPrompt)}P`,
    totalPrompt,
    remainingPrompt: safeRemainingPrompt,
    usedPrompt,
  };
}

export function normalizeMiniMaxRegion(value: unknown): MiniMaxEndpointMode {
  const normalized = normalizeStringValue(value)?.toLowerCase();
  if (["cn", "china", "domestic", "mainland"].includes(normalized || "")) return "cn";
  if (["global", "intl", "international", "overseas"].includes(normalized || "")) return "global";
  return "auto";
}

function inferMiniMaxRegionFromUrl(url: string): MiniMaxEndpointRegion {
  return url.includes("minimaxi.com") ? "cn" : "global";
}

function normalizeMiniMaxEndpointUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/coding_plan/remains") ? trimmed : `${trimmed}${MINIMAX_REMAINS_PATH}`;
}

export function getMiniMaxEndpointCandidates(mode: MiniMaxEndpointMode = "auto", customBaseUrl?: unknown): MiniMaxEndpointCandidate[] {
  const custom = normalizeStringValue(customBaseUrl);
  if (custom) {
    const url = normalizeMiniMaxEndpointUrl(custom);
    return [{ region: inferMiniMaxRegionFromUrl(url), url }];
  }

  if (mode === "cn") return [{ region: "cn", url: MINIMAX_CN_USAGE_URL }];
  if (mode === "global") return [{ region: "global", url: MINIMAX_GLOBAL_USAGE_URL }];
  return [
    { region: "cn", url: MINIMAX_CN_USAGE_URL },
    { region: "global", url: MINIMAX_GLOBAL_USAGE_URL },
  ];
}

export function getMiniMaxStatusCode(payload: unknown) {
  const baseResp = getRecord(getRecord(payload).base_resp);
  return normalizeNumberValue(baseResp.status_code);
}

export function getMiniMaxStatusMessage(payload: unknown) {
  const baseResp = getRecord(getRecord(payload).base_resp);
  return normalizeStringValue(baseResp.status_msg);
}

export function resolveMiniMaxPlanType(promptLimit: number | null, region: MiniMaxEndpointRegion) {
  if (promptLimit === null || !Number.isFinite(promptLimit)) return null;
  return planByRegion[region][Math.round(promptLimit)] ?? null;
}

export function buildMiniMaxQuotaData(payload: unknown, region: MiniMaxEndpointRegion): QuotaData {
  const windows = [
    ...getMiniMaxRemains(payload, "model_remains").map((item, index) => toMiniMaxWindow(item, `模型 #${index + 1}`)),
    ...getMiniMaxRemains(payload, "category_remains").map((item, index) => toMiniMaxWindow(item, `类别 #${index + 1}`)),
  ].filter((window): window is RateLimitWindow => Boolean(window));
  const maxPromptLimit = windows.reduce((current, window) => Math.max(current, window.totalPrompt ?? 0), 0);
  const planType = resolveMiniMaxPlanType(maxPromptLimit || null, region);

  return {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}),
    windows,
    planType: planType ?? undefined,
    plan_type: planType ?? undefined,
    tierLabel: titleCase(planType),
    endpointRegion: region,
  };
}

export function isMiniMaxAuthIndex(value: unknown) {
  return String(value ?? "").trim() === MINIMAX_AUTH_INDEX;
}

export async function fetchMiniMaxQuota(file: AuthFile) {
  if (!isMiniMaxAuthIndex(file.authIndex)) {
    throw new Error("Missing MiniMax auth index");
  }

  const response = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex: file.authIndex,
      provider: "minimax",
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  const statusCode = getMiniMaxStatusCode(payload);
  if (statusCode !== 0) {
    const statusMessage = getMiniMaxStatusMessage(payload);
    throw new Error(`MiniMax API Error ${statusCode ?? "unknown"}${statusMessage ? `: ${statusMessage}` : ""}`);
  }

  const region = normalizeMiniMaxRegion(payload.endpointRegion);
  const data = buildMiniMaxQuotaData(payload, region === "cn" ? "cn" : "global");
  if (!data.windows?.length) {
    throw new Error("No quota data available");
  }

  return data;
}
