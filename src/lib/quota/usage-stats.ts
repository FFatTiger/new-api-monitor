import { normalizeAuthIndex } from "./auth-files.ts";
import { getQuotaServerConfig, type QuotaServerConfig } from "./server-auth-files.ts";

export type AuthIndexUsageStats = Record<string, { success: number; failure: number }>;

type UsageDetail = {
  auth_index?: number | string;
  failed?: boolean;
};

type UsageModelEntry = {
  details?: UsageDetail[];
};

type UsageApiEntry = {
  models?: Record<string, UsageModelEntry>;
};

type UsagePayload = {
  apis?: Record<string, UsageApiEntry>;
  usage?: UsagePayload;
};

export function computeAuthIndexStats(usageData: UsagePayload | null | undefined): AuthIndexUsageStats {
  const payload = usageData?.usage ?? usageData;
  const apis = payload?.apis || {};
  const stats: AuthIndexUsageStats = {};

  Object.values(apis).forEach((apiEntry) => {
    const models = apiEntry?.models || {};
    Object.values(models).forEach((modelEntry) => {
      const details = Array.isArray(modelEntry?.details) ? modelEntry.details : [];
      details.forEach((detail) => {
        const authIndexKey = normalizeAuthIndex(detail?.auth_index);
        if (!authIndexKey) return;

        if (!stats[authIndexKey]) {
          stats[authIndexKey] = { success: 0, failure: 0 };
        }

        if (detail?.failed === true) {
          stats[authIndexKey].failure += 1;
        } else {
          stats[authIndexKey].success += 1;
        }
      });
    });
  });

  return stats;
}

export async function fetchBackendUsageStats(
  config: QuotaServerConfig = getQuotaServerConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<AuthIndexUsageStats> {
  if (!config.apiBaseUrl || !config.apiManagementKey) {
    return {};
  }

  const response = await fetchImpl(`${config.apiBaseUrl}/usage`, {
    headers: {
      Authorization: `Bearer ${config.apiManagementKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend usage request failed: ${response.status}`);
  }

  return computeAuthIndexStats((await response.json()) as UsagePayload);
}
