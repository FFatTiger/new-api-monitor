export type QuotaProviderType = "antigravity" | "claude" | "codex" | "gemini-cli" | "kimi" | "xai" | "unknown";

export type GenericRecord = Record<string, unknown>;

export type ApiCallEnvelope = {
  statusCode: number;
  bodyText: string;
  body: unknown;
};

export type AntigravityQuotaInfo = {
  displayName?: string;
  quotaInfo?: GenericRecord;
  quota_info?: GenericRecord;
};

export type AntigravityQuotaGroup = {
  id: string;
  label: string;
  models: string[];
  remainingFraction: number;
  resetTime?: string | number;
};

export type CodexUsageWindow = {
  used_percent?: number | string;
  usedPercent?: number | string;
  limit_window_seconds?: number | string;
  limitWindowSeconds?: number | string;
  reset_after_seconds?: number | string;
  resetAfterSeconds?: number | string;
  reset_at?: number | string;
  resetAt?: number | string;
};

export type CodexRateLimitInfo = {
  allowed?: boolean;
  limit_reached?: boolean;
  limitReached?: boolean;
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
};

export type CodexAdditionalRateLimit = {
  limit_name?: string;
  limitName?: string;
  metered_feature?: string;
  meteredFeature?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
};

export type CodexUsagePayload = {
  plan_type?: string;
  planType?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
  code_review_rate_limit?: CodexRateLimitInfo | null;
  codeReviewRateLimit?: CodexRateLimitInfo | null;
  additional_rate_limits?: CodexAdditionalRateLimit[] | null;
  additionalRateLimits?: CodexAdditionalRateLimit[] | null;
};

export type CodexQuotaWindow = {
  id: string;
  label: string;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetTime?: string | number;
};

export type GeminiCliBucket = {
  modelId?: string;
  model_id?: string;
  tokenType?: string;
  token_type?: string;
  remainingFraction?: number | string;
  remaining_fraction?: number | string;
  remainingAmount?: number | string;
  remaining_amount?: number | string;
  resetTime?: string | number;
  reset_time?: string | number;
};

export type GeminiCliQuotaBucket = {
  id: string;
  label: string;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime?: string | number;
  tokenType: string | null;
  modelIds: string[];
};

export type ClaudeUsageWindow = {
  utilization?: number | string;
  resets_at?: string | number;
};

export type ClaudeUsagePayload = {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_oauth_apps?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
  seven_day_sonnet?: ClaudeUsageWindow | null;
  seven_day_cowork?: ClaudeUsageWindow | null;
  iguana_necktie?: ClaudeUsageWindow | null;
  extra_usage?: GenericRecord | null;
};

export type ClaudeQuotaWindow = {
  id: string;
  label: string;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetTime?: string | number;
};

export const ANTIGRAVITY_QUOTA_URLS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
] as const;

export const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "antigravity/1.11.5 windows/amd64",
} as const;

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export const CODEX_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
} as const;

export const GEMINI_CLI_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
export const GEMINI_CLI_CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

export const GEMINI_CLI_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
} as const;

export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";

export const CLAUDE_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "anthropic-beta": "oauth-2025-04-20",
} as const;

export const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";

export const KIMI_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
} as const;

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;

type AntigravityQuotaGroupDefinition = {
  id: string;
  label: string;
  identifiers: readonly string[];
  labelFromModel?: boolean;
};

const ANTIGRAVITY_QUOTA_GROUPS: readonly AntigravityQuotaGroupDefinition[] = [
  {
    id: "claude-gpt",
    label: "Claude/GPT",
    identifiers: ["claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"],
  },
  {
    id: "gemini-3-pro",
    label: "Gemini 3 Pro",
    identifiers: ["gemini-3-pro-high", "gemini-3-pro-low"],
  },
  {
    id: "gemini-3-1-pro-series",
    label: "Gemini 3.1 Pro Series",
    identifiers: ["gemini-3.1-pro-high", "gemini-3.1-pro-low"],
  },
  {
    id: "gemini-2-5-flash",
    label: "Gemini 2.5 Flash",
    identifiers: ["gemini-2.5-flash", "gemini-2.5-flash-thinking"],
  },
  {
    id: "gemini-2-5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    identifiers: ["gemini-2.5-flash-lite"],
  },
  {
    id: "gemini-2-5-cu",
    label: "Gemini 2.5 CU",
    identifiers: ["rev19-uic3-1p"],
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    identifiers: ["gemini-3-flash"],
  },
  {
    id: "gemini-image",
    label: "gemini-3.1-flash-image",
    identifiers: ["gemini-3.1-flash-image"],
    labelFromModel: true,
  },
] as const;

const GEMINI_CLI_QUOTA_GROUPS = [
  {
    id: "gemini-flash-lite-series",
    label: "Gemini Flash Lite Series",
    preferredModelId: "gemini-2.5-flash-lite",
    modelIds: ["gemini-2.5-flash-lite"],
  },
  {
    id: "gemini-flash-series",
    label: "Gemini Flash Series",
    preferredModelId: "gemini-3-flash-preview",
    modelIds: ["gemini-3-flash-preview", "gemini-2.5-flash"],
  },
  {
    id: "gemini-pro-series",
    label: "Gemini Pro Series",
    preferredModelId: "gemini-3.1-pro-preview",
    modelIds: ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro"],
  },
] as const;

const GEMINI_CLI_GROUP_ORDER: Map<string, number> = new Map(
  GEMINI_CLI_QUOTA_GROUPS.map((group, index) => [group.id, index] as const),
);
const GEMINI_CLI_GROUP_LOOKUP: Map<string, (typeof GEMINI_CLI_QUOTA_GROUPS)[number]> = new Map(
  GEMINI_CLI_QUOTA_GROUPS.flatMap((group) => group.modelIds.map((modelId) => [modelId, group] as const)),
);

const CLAUDE_USAGE_WINDOW_KEYS = [
  { key: "five_hour", id: "five-hour", label: "5小时窗口" },
  { key: "seven_day", id: "seven-day", label: "7天窗口" },
  { key: "seven_day_oauth_apps", id: "seven-day-oauth-apps", label: "OAuth Apps 7天" },
  { key: "seven_day_opus", id: "seven-day-opus", label: "Opus 7天" },
  { key: "seven_day_sonnet", id: "seven-day-sonnet", label: "Sonnet 7天" },
  { key: "seven_day_cowork", id: "seven-day-cowork", label: "协作 7天" },
  { key: "iguana_necktie", id: "iguana-necktie", label: "Iguana Necktie" },
] as const;

export function normalizeStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  return null;
}

export function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeQuotaFraction(value: unknown): number | null {
  const normalized = normalizeNumberValue(value);
  if (normalized !== null) return normalized;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith("%")) {
      const parsed = Number(trimmed.slice(0, -1));
      return Number.isFinite(parsed) ? parsed / 100 : null;
    }
  }
  return null;
}

export function normalizeCodexPlanType(value: unknown): string | null {
  const normalized = normalizeStringValue(value)?.toLowerCase().replace(/[-_]/g, "");
  if (!normalized) return null;
  if (normalized === "prolite") return "prolite";
  return normalized;
}

export function getCodexPlanLabel(value: unknown): string | null {
  const planType = normalizeCodexPlanType(value);
  if (!planType) return "Free";
  if (planType.includes("enterprise")) return "Enterprise";
  if (planType.includes("team")) return "Team";
  if (planType.includes("prolite")) return "Pro 5x";
  if (planType.includes("pro")) return "Pro 20x";
  if (planType.includes("plus")) return "Plus";
  if (planType.includes("free")) return "Free";
  return planType;
}

export function resolveProviderType(file: { type?: unknown; provider?: unknown }): QuotaProviderType {
  const raw = normalizeStringValue(file.type ?? file.provider)?.toLowerCase() ?? "";
  if (raw === "antigravity") return "antigravity";
  if (raw === "claude" || raw === "anthropic") return "claude";
  if (raw === "codex") return "codex";
  if (raw === "gemini-cli") return "gemini-cli";
  if (raw === "kimi") return "kimi";
  if (raw === "xai" || raw === "x-ai" || raw === "x.ai" || raw === "grok") return "xai";
  return "unknown";
}

export function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeApiCallEnvelope(value: unknown): ApiCallEnvelope {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as GenericRecord) : {};
  const statusCode = normalizeNumberValue(record.statusCode ?? record.status_code) ?? 0;
  const body = parseJsonMaybe(record.body);
  const bodyText = typeof record.body === "string" ? record.body : record.bodyText ? String(record.bodyText) : "";
  return { statusCode, bodyText, body };
}

export function getApiCallErrorMessage(value: unknown): string {
  const envelope = normalizeApiCallEnvelope(value);
  const body = envelope.body;
  let message = "";

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as GenericRecord;
    const error = record.error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      message = normalizeStringValue((error as GenericRecord).message) ?? "";
    } else {
      message = normalizeStringValue(error) ?? "";
    }
    message ||= normalizeStringValue(record.message) ?? "";
  } else {
    message = normalizeStringValue(body) ?? "";
  }

  message ||= envelope.bodyText;
  if (envelope.statusCode && message) return `${envelope.statusCode} ${message}`.trim();
  if (envelope.statusCode) return `HTTP ${envelope.statusCode}`;
  return message || "Request failed";
}

function getRecord(value: unknown): GenericRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as GenericRecord) : null;
}

function getWindowSeconds(window?: CodexUsageWindow | null): number | null {
  if (!window) return null;
  return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
}

function getResetTime(window?: CodexUsageWindow | null): string | number | undefined {
  if (!window) return undefined;
  const value = window.reset_at ?? window.resetAt ?? window.reset_after_seconds ?? window.resetAfterSeconds;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function addCodexWindow(
  windows: CodexQuotaWindow[],
  id: string,
  label: string,
  window?: CodexUsageWindow | null,
  limitReached?: boolean,
  allowed?: boolean,
) {
  if (!window) return;

  const usedPercent = normalizeNumberValue(window.used_percent ?? window.usedPercent);
  const reached = Boolean(limitReached) || allowed === false;
  const effectiveUsed = usedPercent ?? (reached && getResetTime(window) !== undefined ? 100 : null);
  const remainingPercent = effectiveUsed === null ? null : Math.max(0, Math.min(100, 100 - effectiveUsed));

  windows.push({
    id,
    label,
    usedPercent: effectiveUsed,
    remainingPercent,
    resetTime: getResetTime(window),
  });
}

function pickClassifiedCodexWindows(limitInfo?: CodexRateLimitInfo | null) {
  const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
  const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
  const rawWindows = [primaryWindow, secondaryWindow];

  let fiveHourWindow: CodexUsageWindow | null = null;
  let weeklyWindow: CodexUsageWindow | null = null;

  for (const window of rawWindows) {
    const seconds = getWindowSeconds(window);
    if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window;
    } else if (seconds === WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window;
    }
  }

  if (!fiveHourWindow) {
    fiveHourWindow = primaryWindow && primaryWindow !== weeklyWindow ? primaryWindow : null;
  }
  if (!weeklyWindow) {
    weeklyWindow = secondaryWindow && secondaryWindow !== fiveHourWindow ? secondaryWindow : null;
  }

  return { fiveHourWindow, weeklyWindow };
}

function normalizeWindowId(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildCodexQuotaWindows(payload: CodexUsagePayload): CodexQuotaWindow[] {
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit = payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
  const windows: CodexQuotaWindow[] = [];

  const rateWindows = pickClassifiedCodexWindows(rateLimit);
  addCodexWindow(
    windows,
    "codex-five-hour",
    "5小时窗口",
    rateWindows.fiveHourWindow,
    rateLimit?.limit_reached ?? rateLimit?.limitReached,
    rateLimit?.allowed,
  );
  addCodexWindow(
    windows,
    "codex-weekly",
    "周窗口",
    rateWindows.weeklyWindow,
    rateLimit?.limit_reached ?? rateLimit?.limitReached,
    rateLimit?.allowed,
  );

  const reviewWindows = pickClassifiedCodexWindows(codeReviewLimit);
  addCodexWindow(
    windows,
    "code-review-five-hour",
    "代码审查 5小时",
    reviewWindows.fiveHourWindow,
    codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached,
    codeReviewLimit?.allowed,
  );
  addCodexWindow(
    windows,
    "code-review-weekly",
    "代码审查周窗口",
    reviewWindows.weeklyWindow,
    codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached,
    codeReviewLimit?.allowed,
  );

  if (Array.isArray(additionalRateLimits)) {
    additionalRateLimits.forEach((limitItem, index) => {
      const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
      if (!rateInfo) return;

      const limitName =
        normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
        normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
        `additional-${index + 1}`;
      const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
      const primaryWindow = rateInfo.primary_window ?? rateInfo.primaryWindow ?? null;
      const secondaryWindow = rateInfo.secondary_window ?? rateInfo.secondaryWindow ?? null;

      addCodexWindow(
        windows,
        `${idPrefix}-five-hour-${index}`,
        `${limitName} 5小时`,
        primaryWindow,
        rateInfo.limit_reached ?? rateInfo.limitReached,
        rateInfo.allowed,
      );
      addCodexWindow(
        windows,
        `${idPrefix}-weekly-${index}`,
        `${limitName} 周窗口`,
        secondaryWindow,
        rateInfo.limit_reached ?? rateInfo.limitReached,
        rateInfo.allowed,
      );
    });
  }

  return windows;
}

export function getAntigravityQuotaInfo(entry?: AntigravityQuotaInfo) {
  if (!entry) return { remainingFraction: null };
  const quotaInfo = entry.quotaInfo ?? entry.quota_info ?? {};
  const remainingFraction = normalizeQuotaFraction(
    quotaInfo.remainingFraction ?? quotaInfo.remaining_fraction ?? quotaInfo.remaining,
  );
  const resetValue = quotaInfo.resetTime ?? quotaInfo.reset_time;

  return {
    remainingFraction,
    resetTime: typeof resetValue === "string" || typeof resetValue === "number" ? resetValue : undefined,
    displayName: typeof entry.displayName === "string" ? entry.displayName : undefined,
  };
}

function findAntigravityModel(models: Record<string, AntigravityQuotaInfo>, identifier: string) {
  const direct = models[identifier];
  if (direct) return { id: identifier, entry: direct };

  const match = Object.entries(models).find(([, entry]) => {
    const name = typeof entry?.displayName === "string" ? entry.displayName : "";
    return name.toLowerCase() === identifier.toLowerCase();
  });
  return match ? { id: match[0], entry: match[1] } : null;
}

export function buildAntigravityQuotaGroups(models: Record<string, AntigravityQuotaInfo>): AntigravityQuotaGroup[] {
  const groups: AntigravityQuotaGroup[] = [];
  const definitions = new Map(ANTIGRAVITY_QUOTA_GROUPS.map((definition) => [definition.id, definition] as const));

  const buildGroup = (
    definition: AntigravityQuotaGroupDefinition,
    overrideResetTime?: string | number,
  ): AntigravityQuotaGroup | null => {
    const matches = definition.identifiers
      .map((identifier) => findAntigravityModel(models, identifier))
      .filter((entry): entry is { id: string; entry: AntigravityQuotaInfo } => Boolean(entry));

    const quotaEntries = matches
      .map(({ id, entry }) => {
        const info = getAntigravityQuotaInfo(entry);
        const remainingFraction = info.remainingFraction ?? (info.resetTime ? 0 : null);
        if (remainingFraction === null) return null;
        return {
          id,
          remainingFraction,
          resetTime: info.resetTime,
          displayName: info.displayName,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (quotaEntries.length === 0) return null;

    const displayName = quotaEntries.map((entry) => entry.displayName).find(Boolean);
    return {
      id: definition.id,
      label: definition.labelFromModel && displayName ? displayName : definition.label,
      models: quotaEntries.map((entry) => entry.id),
      remainingFraction: Math.min(...quotaEntries.map((entry) => entry.remainingFraction)),
      resetTime: overrideResetTime ?? quotaEntries.map((entry) => entry.resetTime).find(Boolean),
    };
  };

  const appendGroup = (id: string, overrideResetTime?: string | number) => {
    const definition = definitions.get(id);
    if (!definition) return null;
    const group = buildGroup(definition, overrideResetTime);
    if (group) groups.push(group);
    return group;
  };

  appendGroup("claude-gpt");
  const gemini31ProGroup = appendGroup("gemini-3-1-pro-series");
  const geminiProGroup = appendGroup("gemini-3-pro");
  const geminiProResetTime = gemini31ProGroup?.resetTime ?? geminiProGroup?.resetTime;
  appendGroup("gemini-2-5-flash");
  appendGroup("gemini-2-5-flash-lite");
  appendGroup("gemini-2-5-cu");
  appendGroup("gemini-3-flash");
  appendGroup("gemini-image", geminiProResetTime);

  return groups;
}

export function normalizeGeminiCliModelId(value: unknown): string | null {
  const modelId = normalizeStringValue(value);
  if (!modelId) return null;
  return modelId.endsWith("_vertex") ? modelId.slice(0, -"_vertex".length) : modelId;
}

function pickEarlierResetTime(current?: string | number, next?: string | number): string | number | undefined {
  if (!current) return next;
  if (!next) return current;
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (Number.isNaN(currentTime)) return next;
  if (Number.isNaN(nextTime)) return current;
  return currentTime <= nextTime ? current : next;
}

function minNullableNumber(current: number | null, next: number | null): number | null {
  if (current === null) return next;
  if (next === null) return current;
  return Math.min(current, next);
}

export function buildGeminiCliQuotaBuckets(rawBuckets: GeminiCliBucket[]): GeminiCliQuotaBucket[] {
  type ParsedBucket = {
    modelId: string;
    tokenType: string | null;
    remainingFraction: number | null;
    remainingAmount: number | null;
    resetTime?: string | number;
  };

  type BucketGroup = {
    id: string;
    label: string;
    tokenType: string | null;
    modelIds: string[];
    preferredModelId?: string;
    preferredBucket?: ParsedBucket;
    fallbackRemainingFraction: number | null;
    fallbackRemainingAmount: number | null;
    fallbackResetTime?: string | number;
  };

  const grouped = new Map<string, BucketGroup>();

  rawBuckets.forEach((rawBucket) => {
    const modelId = normalizeGeminiCliModelId(rawBucket.modelId ?? rawBucket.model_id);
    if (!modelId || modelId === "gemini-2.0-flash" || modelId.startsWith("gemini-2.0-flash-")) return;

    const remainingAmount = normalizeNumberValue(rawBucket.remainingAmount ?? rawBucket.remaining_amount);
    const resetTime = rawBucket.resetTime ?? rawBucket.reset_time;
    const bucket: ParsedBucket = {
      modelId,
      tokenType: normalizeStringValue(rawBucket.tokenType ?? rawBucket.token_type),
      remainingFraction:
        normalizeQuotaFraction(rawBucket.remainingFraction ?? rawBucket.remaining_fraction) ??
        (remainingAmount !== null && remainingAmount <= 0 ? 0 : resetTime ? 0 : null),
      remainingAmount,
      resetTime: typeof resetTime === "string" || typeof resetTime === "number" ? resetTime : undefined,
    };

    const group = GEMINI_CLI_GROUP_LOOKUP.get(modelId);
    const groupId = group?.id ?? modelId;
    const tokenKey = bucket.tokenType ?? "";
    const mapKey = `${groupId}::${tokenKey}`;
    const existing = grouped.get(mapKey);

    if (!existing) {
      grouped.set(mapKey, {
        id: `${groupId}${tokenKey ? `-${tokenKey}` : ""}`,
        label: group?.label ?? modelId,
        tokenType: bucket.tokenType,
        modelIds: [modelId],
        preferredModelId: group?.preferredModelId,
        preferredBucket: group?.preferredModelId === modelId ? bucket : undefined,
        fallbackRemainingFraction: bucket.remainingFraction,
        fallbackRemainingAmount: bucket.remainingAmount,
        fallbackResetTime: bucket.resetTime,
      });
      return;
    }

    existing.modelIds.push(modelId);
    existing.fallbackRemainingFraction = minNullableNumber(existing.fallbackRemainingFraction, bucket.remainingFraction);
    existing.fallbackRemainingAmount = minNullableNumber(existing.fallbackRemainingAmount, bucket.remainingAmount);
    existing.fallbackResetTime = pickEarlierResetTime(existing.fallbackResetTime, bucket.resetTime);
    if (existing.preferredModelId === modelId) {
      existing.preferredBucket = bucket;
    }
  });

  const toGroupOrder = (bucket: BucketGroup) => {
    const tokenSuffix = bucket.tokenType ? `-${bucket.tokenType}` : "";
    const groupId = tokenSuffix && bucket.id.endsWith(tokenSuffix) ? bucket.id.slice(0, -tokenSuffix.length) : bucket.id;
    return GEMINI_CLI_GROUP_ORDER.get(groupId) ?? Number.MAX_SAFE_INTEGER;
  };

  return Array.from(grouped.values())
    .sort((a, b) => toGroupOrder(a) - toGroupOrder(b) || (a.tokenType ?? "").localeCompare(b.tokenType ?? ""))
    .map((bucket) => {
      const preferred = bucket.preferredBucket;
      return {
        id: bucket.id,
        label: bucket.label,
        remainingFraction: preferred ? preferred.remainingFraction : bucket.fallbackRemainingFraction,
        remainingAmount: preferred ? preferred.remainingAmount : bucket.fallbackRemainingAmount,
        resetTime: preferred ? preferred.resetTime : bucket.fallbackResetTime,
        tokenType: bucket.tokenType,
        modelIds: Array.from(new Set(bucket.modelIds)),
      };
    });
}

export function buildClaudeQuotaWindows(payload: ClaudeUsagePayload): ClaudeQuotaWindow[] {
  const windows: ClaudeQuotaWindow[] = [];

  for (const item of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[item.key];
    if (!window || typeof window !== "object") continue;
    const usedPercent = normalizeNumberValue(window.utilization);
    windows.push({
      id: item.id,
      label: item.label,
      usedPercent,
      remainingPercent: usedPercent === null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
      resetTime: window.resets_at,
    });
  }

  return windows;
}

function normalizeFlagValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return undefined;
}

export function resolveClaudePlanType(profile: unknown): string | null {
  const record = getRecord(profile);
  if (!record) return null;
  const account = getRecord(record.account);
  const organization = getRecord(record.organization);

  if (normalizeFlagValue(account?.has_claude_max)) return "max";
  if (normalizeFlagValue(account?.has_claude_pro)) return "pro";

  const organizationType = normalizeStringValue(organization?.organization_type)?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(organization?.subscription_status)?.toLowerCase();
  if (organizationType === "claude_team" && subscriptionStatus === "active") return "team";

  if (normalizeFlagValue(account?.has_claude_max) === false && normalizeFlagValue(account?.has_claude_pro) === false) {
    return "free";
  }

  return null;
}
