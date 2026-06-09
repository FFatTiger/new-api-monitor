import type { ProviderType } from "@/types/quota";

export type QuotaUsageGroupMap = Partial<Record<ProviderType, number[]>>;

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
