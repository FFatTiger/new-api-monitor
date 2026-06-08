import type { AuthFile } from "@/types/auth";

export type ProviderType = "antigravity" | "claude" | "codex" | "gemini-cli" | "kimi" | "minimax" | "xai" | "zai" | "unknown";
export type ProviderFilter = "all" | Exclude<ProviderType, "unknown">;

export interface QuotaState {
  loading: boolean;
  error?: string;
  data?: QuotaData;
  lastUpdated?: number;
  successCount?: number;
  failureCount?: number;
}

export interface QuotaInfo {
  remaining_fraction?: number;
  remainingFraction?: number;
  remaining?: number;
  resetTime?: string | number;
  reset_time?: string | number;
}

export interface ModelData {
  quotaInfo?: QuotaInfo;
  quota_info?: QuotaInfo;
}

export interface BucketData {
  id?: string;
  label?: string;
  model_id?: string;
  modelId?: string;
  tokenType?: string | null;
  token_type?: string | null;
  remaining_fraction?: number;
  remainingFraction?: number;
  remainingAmount?: number | null;
  remaining_amount?: number | null;
  reset_time?: string | number;
  resetTime?: string | number;
}

export interface RateLimitWindow {
  used_percent?: number;
  usedPercent?: number;
  remainingPercent?: number | null;
  remaining_percent?: number | null;
  reset_at?: string | number;
  resetAt?: string | number;
  resetTime?: string | number;
  reset_time?: string | number;
  label?: string;
  id?: string;
  valueLabel?: string;
  totalPrompt?: number;
  remainingPrompt?: number;
  usedPrompt?: number;
}

export interface RateLimitData {
  limit_reached?: boolean;
  primary_window?: RateLimitWindow;
  primaryWindow?: RateLimitWindow;
  secondary_window?: RateLimitWindow;
  secondaryWindow?: RateLimitWindow;
}

export interface KimiQuotaRow {
  id: string;
  label: string;
  used: number;
  limit: number;
  resetHint?: string;
  resetTime?: number;
}

export interface QuotaData {
  models?: Record<string, ModelData>;
  groups?: Array<{ id: string; label: string; models: string[]; remainingFraction: number; resetTime?: string | number }>;
  rate_limit?: RateLimitData;
  rateLimit?: RateLimitData;
  windows?: RateLimitWindow[];
  buckets?: BucketData[];
  rows?: KimiQuotaRow[];
  plan_type?: string;
  planType?: string;
  extra_usage?: Record<string, unknown> | null;
  extraUsage?: Record<string, unknown> | null;
  tierLabel?: string | null;
  tierId?: string | null;
  creditBalance?: number | null;
  endpointRegion?: string | null;
}

export type QuotaUsagePredictionStatus = "ready" | "unconfigured" | "no_snapshot" | "no_recent_usage" | "exhausted";

export interface QuotaUsagePredictionRow {
  provider: ProviderType;
  channelIds: number[];
  configured: boolean;
  todayGptTokens: number;
  todayQuota: number;
  recentQuota: number;
  recentQuotaPerHour: number | null;
  latestRemainingPercent: number | null;
  latestUsedPercent: number | null;
  resetTime: string | null;
  minutesLeft: number | null;
  exhaustAt: number | null;
  status: QuotaUsagePredictionStatus;
}

export interface CacheData {
  authFiles: AuthFile[];
  quotas: Record<string, QuotaState>;
  timestamp: number;
}
