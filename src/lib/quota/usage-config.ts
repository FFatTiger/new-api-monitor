import type { ProviderType } from "@/types/quota";

export type QuotaUsageGroupMap = Partial<Record<ProviderType, number[]>>;

export const DEFAULT_QUOTA_USAGE_WINDOW_MINUTES = 180;

export const QUOTA_USAGE_WINDOW_OPTIONS = [
  { minutes: 60, label: "60 分钟" },
  { minutes: 180, label: "3 小时" },
  { minutes: 360, label: "6 小时" },
  { minutes: 720, label: "12 小时" },
  { minutes: 1440, label: "1 天" },
] as const;

const validProviders = new Set<ProviderType>([
  "antigravity",
  "claude",
  "codex",
  "gemini-cli",
  "kimi",
  "minimax",
  "xai",
  "zai",
]);

export function normalizeQuotaUsageWindowMinutes(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return QUOTA_USAGE_WINDOW_OPTIONS.some((option) => option.minutes === numeric)
    ? numeric
    : DEFAULT_QUOTA_USAGE_WINDOW_MINUTES;
}

export function parseQuotaUsageGroups(value: unknown): QuotaUsageGroupMap {
  if (typeof value !== "string" || !value.trim()) return {};

  const groups: QuotaUsageGroupMap = {};
  value.split(";").forEach((entry) => {
    const [rawProvider, rawChannels] = entry.split("=");
    const provider = rawProvider?.trim().toLowerCase() as ProviderType;
    if (!validProviders.has(provider) || !rawChannels) return;

    const channels = Array.from(
      new Set(
        rawChannels
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((channelId) => Number.isInteger(channelId) && channelId > 0),
      ),
    );

    if (channels.length > 0) {
      groups[provider] = channels;
    }
  });

  return groups;
}

export function getQuotaUsageGroupsFromEnv() {
  return parseQuotaUsageGroups(process.env.QUOTA_USAGE_GROUPS || process.env.NEW_API_MONITOR_QUOTA_USAGE_GROUPS || "");
}
