import type { AuthFile } from "@/types/auth";

export type ProviderType = "antigravity" | "codex" | "gemini-cli" | "kimi" | "unknown";
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
  model_id?: string;
  modelId?: string;
  remaining_fraction?: number;
  remainingFraction?: number;
  reset_time?: string | number;
  resetTime?: string | number;
}

export interface RateLimitWindow {
  used_percent?: number;
  usedPercent?: number;
  reset_at?: string | number;
  resetAt?: string | number;
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
  rate_limit?: RateLimitData;
  rateLimit?: RateLimitData;
  buckets?: BucketData[];
  rows?: KimiQuotaRow[];
  plan_type?: string;
  planType?: string;
}

export interface CacheData {
  authFiles: AuthFile[];
  quotas: Record<string, QuotaState>;
  timestamp: number;
}
