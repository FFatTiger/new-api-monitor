import type {
  DashboardFilters,
  FilterPreset,
  SearchParamsInput,
  TokenDetailData,
  TrendGranularity,
} from "../queries/dashboard.ts";
import {
  createDashboardRollupPlan,
  type DashboardRollupQueryPlan,
  type DashboardRollupTokenDetailResult,
} from "./rollup-query.ts";
import type { DashboardRollupReadiness } from "./types.ts";

const PRESET_SECONDS = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
} as const;

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const shanghaiDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shanghaiDateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type DashboardQueryPlan =
  | { kind: "legacy"; filters: DashboardFilters }
  | (DashboardRollupQueryPlan & { filters: DashboardFilters })
  | {
      kind: "unavailable";
      filters: DashboardFilters;
      readiness: DashboardRollupReadiness;
    };

export interface DashboardRouteSourceBounds {
  minTimestamp: number;
  maxTimestamp: number;
}

const UNSUPPORTED_CUSTOM_MESSAGE =
  "自定义时间范围无效或超过 7 天。请选择不超过 7 天的区间，或使用「近 30 天 / 不限」查看长期统计。";

const LEGACY_GUARD_MESSAGE =
  "legacy dashboard loaders do not support long-range or unsupported custom filters; use rollup packet routing";

function getFirstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function cleanText(value: string, maxLength = 100) {
  return value.trim().slice(0, maxLength);
}

function normalizeModelName(value: string) {
  return value.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function getShanghaiDateParts(date: Date) {
  const parts = shanghaiDatePartsFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  return { year, month, day };
}

function getShanghaiDateTimeParts(date: Date) {
  const parts = shanghaiDateTimePartsFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { year, month, day, hour, minute };
}

function parseShanghaiDateTimeInput(value: string, endOfMinute = false) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const baseUtcSeconds = Date.UTC(year, month - 1, day, hour, minute, 0) / 1000;

  return baseUtcSeconds - 8 * 60 * 60 + (endOfMinute ? 59 : 0);
}

function formatDateTimeInput(timestamp: number) {
  const { year, month, day, hour, minute } = getShanghaiDateTimeParts(new Date(timestamp * 1000));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getTodayRangeInShanghai() {
  const { year, month, day } = getShanghaiDateParts(new Date());
  const dateString = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    startInput: `${dateString}T00:00`,
    endInput: `${dateString}T23:59`,
    startTimestamp: parseShanghaiDateTimeInput(`${dateString}T00:00`, false),
    endTimestamp: parseShanghaiDateTimeInput(`${dateString}T23:59`, true),
  };
}

function getWindowLabel(
  preset: FilterPreset,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  if (preset === "all") {
    return "全部时间";
  }

  if (preset === "today") {
    return "今天";
  }

  if (preset === "custom" && startTimestamp !== null && endTimestamp !== null) {
    return `${formatDateTimeInput(startTimestamp)} 至 ${formatDateTimeInput(endTimestamp)}`;
  }

  if (preset === "24h") {
    return "近 24 小时";
  }

  if (preset === "30d") {
    return "近 30 天";
  }

  return "近 7 天";
}

function parsePreset(searchParams: SearchParamsInput): FilterPreset {
  const rawPreset = getFirstValue(searchParams.preset);
  if (
    rawPreset === "today" ||
    rawPreset === "24h" ||
    rawPreset === "7d" ||
    rawPreset === "30d" ||
    rawPreset === "custom" ||
    rawPreset === "all"
  ) {
    return rawPreset;
  }
  return "today";
}

function computeGranularity(
  startTimestamp: number | null,
  endTimestamp: number | null,
  sourceBounds?: DashboardRouteSourceBounds,
): TrendGranularity {
  if (startTimestamp !== null && endTimestamp !== null) {
    const rangeSeconds = Math.max(endTimestamp - startTimestamp, 0);
    return rangeSeconds <= 2 * 24 * 60 * 60 ? "hour" : "day";
  }
  if (sourceBounds) {
    const rangeSeconds = Math.max(sourceBounds.maxTimestamp - sourceBounds.minTimestamp, 0);
    return rangeSeconds <= 2 * 24 * 60 * 60 ? "hour" : "day";
  }
  return "day";
}

/**
 * Pure filter parse for routing/shell.
 * - 30d/all: never needs logs MIN/MAX.
 * - custom: only typed start/end inputs; invalid stays null (no silent source-bound substitute).
 * - short presets: use sourceBounds when provided (legacy path).
 */
export function parseDashboardRouteFilters(
  searchParams: SearchParamsInput,
  sourceBounds?: DashboardRouteSourceBounds,
): DashboardFilters {
  const preset = parsePreset(searchParams);
  const token = cleanText(getFirstValue(searchParams.token));
  const username = cleanText(getFirstValue(searchParams.username), 64);
  const model = cleanText(normalizeModelName(getFirstValue(searchParams.model)), 128);
  const channelId = cleanText(getFirstValue(searchParams.channelId), 20);
  const startInput = cleanText(getFirstValue(searchParams.start), 16);
  const endInput = cleanText(getFirstValue(searchParams.end), 16);
  const todayRange = getTodayRangeInShanghai();
  const minTimestamp = sourceBounds?.minTimestamp ?? 0;
  const maxTimestamp = sourceBounds?.maxTimestamp ?? 0;

  let startTimestamp: number | null = null;
  let endTimestamp: number | null = null;
  let resolvedStartInput = startInput;
  let resolvedEndInput = endInput;

  if (preset === "today") {
    startTimestamp = todayRange.startTimestamp ?? (sourceBounds ? minTimestamp : null);
    endTimestamp = todayRange.endTimestamp ?? (sourceBounds ? maxTimestamp : null);
    resolvedStartInput = todayRange.startInput;
    resolvedEndInput = todayRange.endInput;
  } else if (preset === "custom") {
    // Typed inputs only — never fall back to source bounds for invalid custom.
    startTimestamp = parseShanghaiDateTimeInput(startInput, false);
    endTimestamp = parseShanghaiDateTimeInput(endInput, true);
  } else if (preset === "all") {
    startTimestamp = null;
    endTimestamp = null;
  } else if (preset === "30d") {
    // Placeholder bounds for shell; createDashboardRollupPlan owns the exact watermark range.
    if (sourceBounds && maxTimestamp) {
      startTimestamp = maxTimestamp - PRESET_SECONDS["30d"];
      endTimestamp = maxTimestamp;
    } else {
      startTimestamp = null;
      endTimestamp = null;
    }
  } else if (sourceBounds && maxTimestamp) {
    endTimestamp = maxTimestamp;
    startTimestamp = maxTimestamp - PRESET_SECONDS[preset];
  } else {
    startTimestamp = null;
    endTimestamp = null;
  }

  if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
    [startTimestamp, endTimestamp] = [endTimestamp, startTimestamp];
  }

  return {
    preset,
    token,
    username,
    model,
    channelId,
    startInput: resolvedStartInput,
    endInput: resolvedEndInput,
    startTimestamp,
    endTimestamp,
    granularity: computeGranularity(startTimestamp, endTimestamp, sourceBounds),
    windowLabel: getWindowLabel(preset, startTimestamp, endTimestamp),
  };
}

function unsupportedReadiness(message = UNSUPPORTED_CUSTOM_MESSAGE): DashboardRollupReadiness {
  return {
    kind: "unsupported",
    processedRows: 0,
    safeMessage: message,
  };
}

function customSpanSeconds(filters: DashboardFilters): number | null {
  if (filters.startTimestamp === null || filters.endTimestamp === null) {
    return null;
  }
  return Math.max(filters.endTimestamp - filters.startTimestamp, 0);
}

/**
 * Pure plan construction. `readsEnabled` must be true together with readiness.kind=ready
 * for 30d/all to route to rollup.
 */
export function buildDashboardQueryPlan(
  filters: DashboardFilters,
  readiness: DashboardRollupReadiness,
  readsEnabled: boolean,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): DashboardQueryPlan {
  const { preset } = filters;

  if (preset === "today" || preset === "24h" || preset === "7d") {
    return { kind: "legacy", filters };
  }

  if (preset === "custom") {
    const span = customSpanSeconds(filters);
    if (span === null) {
      return {
        kind: "unavailable",
        filters,
        readiness: unsupportedReadiness(),
      };
    }
    if (span > SEVEN_DAYS_SECONDS) {
      return {
        kind: "unavailable",
        filters,
        readiness: unsupportedReadiness(),
      };
    }
    return { kind: "legacy", filters };
  }

  // 30d / all
  if (!readsEnabled || readiness.kind !== "ready") {
    const unavailableReadiness: DashboardRollupReadiness =
      readiness.kind === "ready"
        ? {
            kind: "disabled",
            processedRows: readiness.processedRows,
            safeMessage: "长期统计尚未启用。",
          }
        : readiness;
    return {
      kind: "unavailable",
      filters,
      readiness: unavailableReadiness,
    };
  }

  try {
    const rollupPlan = createDashboardRollupPlan(readiness, filters, nowSeconds);
    return {
      ...rollupPlan,
      filters,
    };
  } catch {
    return {
      kind: "unavailable",
      filters,
      readiness: {
        kind: "unhealthy",
        processedRows: readiness.processedRows,
        safeMessage: "长期统计暂时不可用，请稍后重试。",
      },
    };
  }
}

/** Synchronous guard so accidental long filters never hit raw SQL loaders. */
export function assertLegacyDashboardFilters(filters: DashboardFilters): void {
  const { preset } = filters;
  if (preset === "30d" || preset === "all") {
    throw new Error(LEGACY_GUARD_MESSAGE);
  }
  if (preset === "custom") {
    const span = customSpanSeconds(filters);
    if (span === null || span > SEVEN_DAYS_SECONDS) {
      throw new Error(LEGACY_GUARD_MESSAGE);
    }
  }
}

export function isLongRangePreset(preset: FilterPreset): boolean {
  return preset === "30d" || preset === "all";
}

export function needsSourceBoundsForRouting(preset: FilterPreset): boolean {
  return preset === "today" || preset === "24h" || preset === "7d";
}

export function peekDashboardPreset(searchParams: SearchParamsInput): FilterPreset {
  return parsePreset(searchParams);
}

export type TokenDetailMode = DashboardQueryPlan["kind"];

/**
 * Pure mode projection for token-detail routing tests and call sites.
 * Delegates classification to buildDashboardQueryPlan (does not reimplement rules).
 */
export function resolveTokenDetailMode(
  filters: DashboardFilters,
  readiness: DashboardRollupReadiness,
  readsEnabled: boolean,
  nowSeconds?: number,
): TokenDetailMode {
  return buildDashboardQueryPlan(filters, readiness, readsEnabled, nowSeconds).kind;
}

const TOKEN_DETAIL_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

const TOKEN_DETAIL_GENERIC_ERROR = "Failed to fetch token detail";

export interface TokenDetailRequestInput {
  tokenId: number;
  tokenName: string;
  filters: SearchParamsInput;
}

export interface TokenDetailHandlerResult {
  status: number;
  body: Record<string, unknown>;
  headers: { "Cache-Control": string };
}

export interface TokenDetailHandlerDeps {
  resolvePlan: (filters: SearchParamsInput) => Promise<DashboardQueryPlan>;
  getLegacyDetail: (
    filters: SearchParamsInput | DashboardFilters,
    tokenId: number,
    tokenName: string,
  ) => Promise<TokenDetailData>;
  getRollupDetail: (
    plan: DashboardRollupQueryPlan,
    token: { tokenId: number; tokenName: string },
  ) => Promise<DashboardRollupTokenDetailResult>;
  logError?: (error: unknown) => void;
}

function tokenDetailResponse(
  status: number,
  body: Record<string, unknown>,
): TokenDetailHandlerResult {
  return {
    status,
    body,
    headers: { ...TOKEN_DETAIL_NO_STORE_HEADERS },
  };
}

/**
 * Pure dependency-injected token-detail handler.
 * Classifies once, never falls back from rollup/unavailable to legacy raw detail.
 */
export async function runTokenDetailRequest(
  input: TokenDetailRequestInput,
  deps: TokenDetailHandlerDeps,
): Promise<TokenDetailHandlerResult> {
  const { tokenId, tokenName, filters } = input;

  if (!Number.isFinite(tokenId) || !tokenName) {
    return tokenDetailResponse(400, { error: "Invalid token" });
  }

  // After long classification (rollup/unavailable), unexpected failures stay 503 and never legacy.
  let longClassified = false;

  try {
    const plan = await deps.resolvePlan(filters);

    if (plan.kind === "legacy") {
      const detail = await deps.getLegacyDetail(plan.filters, tokenId, tokenName);
      return tokenDetailResponse(200, { detail });
    }

    longClassified = true;

    if (plan.kind === "unavailable") {
      const readiness = plan.readiness;
      // Unavailable plans always carry a non-ready readiness with safeMessage.
      const error =
        "safeMessage" in readiness
          ? readiness.safeMessage
          : "长期统计暂时不可用，请稍后重试。";
      return tokenDetailResponse(503, {
        error,
        readiness,
      });
    }

    // plan.kind === "rollup" — never call legacy after long classification
    const rollupResult = await deps.getRollupDetail(plan, { tokenId, tokenName });
    if (rollupResult.kind === "ready") {
      return tokenDetailResponse(200, { detail: rollupResult.detail });
    }
    return tokenDetailResponse(503, { error: rollupResult.safeMessage });
  } catch (error: unknown) {
    deps.logError?.(error);
    return tokenDetailResponse(longClassified ? 503 : 500, {
      error: TOKEN_DETAIL_GENERIC_ERROR,
    });
  }
}
