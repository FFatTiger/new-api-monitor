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
  start_time?: unknown;
  remains_time?: unknown;
  end_time?: unknown;
  weekly_start_time?: unknown;
  weekly_remains_time?: unknown;
  weekly_end_time?: unknown;
  current_interval_remaining_percent?: unknown;
  current_weekly_remaining_percent?: unknown;
};

const MINIMAX_REMAINS_PATH = "/v1/api/openplatform/coding_plan/remains";

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, roundOne(value)));
}

function formatPercent(value: number) {
  const rounded = roundOne(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getMiniMaxRemains(payload: unknown): MiniMaxRemain[] {
  const remains = getRecord(payload).model_remains;
  return Array.isArray(remains) ? remains : [];
}

function getMiniMaxResetTime(item: MiniMaxRemain, window: "hour" | "week") {
  const endTime = normalizeNumberValue(window === "hour" ? item.end_time : item.weekly_end_time);
  if (endTime !== null) return endTime;

  const remainsTime = normalizeNumberValue(window === "hour" ? item.remains_time : item.weekly_remains_time);
  return remainsTime === null ? undefined : Date.now() + remainsTime;
}

function getMiniMaxIntervalLabel(item: MiniMaxRemain) {
  const startTime = normalizeNumberValue(item.start_time);
  const endTime = normalizeNumberValue(item.end_time);
  if (startTime === null || endTime === null || endTime <= startTime) return "小时额度";

  const hours = (endTime - startTime) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return "小时额度";
  return `${formatPercent(hours)}小时额度`;
}

function getMiniMaxRemainingPercent(item: MiniMaxRemain, window: "hour" | "week") {
  const value = normalizeNumberValue(
    window === "hour" ? item.current_interval_remaining_percent : item.current_weekly_remaining_percent,
  );
  return value === null ? null : clampPercent(value);
}

function toMiniMaxWindow(item: MiniMaxRemain, window: "hour" | "week"): RateLimitWindow | null {
  const remainingPercent = getMiniMaxRemainingPercent(item, window);
  if (remainingPercent === null) return null;

  return {
    id: `minimax-${window}`,
    label: window === "hour" ? getMiniMaxIntervalLabel(item) : "周额度",
    usedPercent: clampPercent(100 - remainingPercent),
    remainingPercent,
    resetTime: getMiniMaxResetTime(item, window),
    valueLabel: `${formatPercent(remainingPercent)}%`,
  };
}

export function normalizeMiniMaxRegion(value: unknown): MiniMaxEndpointMode {
  const normalized = normalizeStringValue(value)?.split(/\s+/)[0]?.toLowerCase();
  if (["cn", "china", "domestic", "mainland"].includes(normalized || "")) return "cn";
  if (["global", "intl", "international", "overseas"].includes(normalized || "")) return "global";
  return "auto";
}

export function normalizeMiniMaxApiKey(value: unknown) {
  return normalizeStringValue(value)?.split(/\s+/)[0] ?? "";
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

function findPrimaryMiniMaxRemain(payload: unknown): MiniMaxRemain | null {
  return (
    getMiniMaxRemains(payload).find((item) => {
      const name = normalizeStringValue(item.model_name)?.toLowerCase() ?? "";
      return name === "general";
    }) ?? null
  );
}

export function buildMiniMaxQuotaData(payload: unknown, region: MiniMaxEndpointRegion): QuotaData {
  const primaryRemain = findPrimaryMiniMaxRemain(payload);
  const windows = primaryRemain
    ? [toMiniMaxWindow(primaryRemain, "hour"), toMiniMaxWindow(primaryRemain, "week")].filter(
        (window): window is RateLimitWindow => Boolean(window),
      )
    : [];

  return {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}),
    windows,
    planType: undefined,
    plan_type: undefined,
    tierLabel: null,
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
