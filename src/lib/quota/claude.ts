import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";
import {
  buildClaudeQuotaWindows,
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  parseJsonMaybe,
  resolveClaudePlanType,
} from "@/lib/quota/upstream";

async function requestClaudeEndpoint(authIndex: string, url: string) {
  const apiResponse = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex,
      method: "GET",
      url,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  });

  return normalizeApiCallEnvelope(await apiResponse.json());
}

export const fetchClaudeQuota = async (file: AuthFile) => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Claude");
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    requestClaudeEndpoint(authIndex, CLAUDE_USAGE_URL),
    requestClaudeEndpoint(authIndex, CLAUDE_PROFILE_URL),
  ]);

  if (usageResult.status === "rejected") {
    throw usageResult.reason;
  }

  const usage = usageResult.value;
  if (usage.statusCode < 200 || usage.statusCode >= 300) {
    throw new Error(`API Error ${getApiCallErrorMessage(usage)}`);
  }

  const payload = parseJsonMaybe(usage.body ?? usage.bodyText);
  if (!payload || typeof payload !== "object") {
    throw new Error("No quota data available");
  }

  const profile =
    profileResult.status === "fulfilled" &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? parseJsonMaybe(profileResult.value.body ?? profileResult.value.bodyText)
      : null;

  return {
    windows: buildClaudeQuotaWindows(payload),
    extra_usage: (payload as Record<string, unknown>).extra_usage ?? null,
    planType: resolveClaudePlanType(profile),
  };
};
