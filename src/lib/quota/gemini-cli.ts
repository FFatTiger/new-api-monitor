import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";
import {
  buildGeminiCliQuotaBuckets,
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  normalizeNumberValue,
  normalizeStringValue,
  parseJsonMaybe,
} from "@/lib/quota/upstream";

const extractProjectIdFromAccount = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const matches = Array.from(value.matchAll(/\(([^()]+)\)/g));
  if (matches.length === 0) return null;

  const candidate = matches[matches.length - 1]?.[1]?.trim();
  return candidate ? candidate : null;
};

async function fetchGeminiCliCodeAssist(authIndex: string, projectId: string) {
  try {
    const apiResponse = await apiFetch("/quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authIndex,
        method: "POST",
        url: GEMINI_CLI_CODE_ASSIST_URL,
        header: { ...GEMINI_CLI_REQUEST_HEADERS },
        data: JSON.stringify({
          cloudaicompanionProject: projectId,
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
            duetProject: projectId,
          },
        }),
      }),
    });

    const result = normalizeApiCallEnvelope(await apiResponse.json());
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return {};
    }

    const payload = parseJsonMaybe(result.body ?? result.bodyText);
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const currentTier = data.currentTier || data.current_tier;
    const paidTier = data.paidTier || data.paid_tier;
    const tier = paidTier && typeof paidTier === "object" ? paidTier : currentTier;
    const tierRecord = tier && typeof tier === "object" ? (tier as Record<string, unknown>) : {};
    const rawTierId = normalizeStringValue(tierRecord.id);
    const credits = tierRecord.availableCredits || tierRecord.available_credits;
    let creditBalance: number | null = null;

    if (Array.isArray(credits)) {
      for (const credit of credits) {
        const record = credit && typeof credit === "object" ? (credit as Record<string, unknown>) : {};
        const creditType = normalizeStringValue(record.creditType ?? record.credit_type);
        if (creditType !== "GOOGLE_ONE_AI") continue;
        const amount = normalizeNumberValue(record.creditAmount ?? record.credit_amount);
        if (amount !== null) {
          creditBalance = (creditBalance ?? 0) + amount;
        }
      }
    }

    return {
      tierId: rawTierId?.toLowerCase() ?? null,
      tierLabel: rawTierId ?? null,
      creditBalance,
    };
  } catch {
    return {};
  }
}

export const fetchGeminiCliQuota = async (file: AuthFile) => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Gemini CLI");
  }

  const project = extractProjectIdFromAccount(file.account);
  if (!project) {
    throw new Error("Could not find project ID in account field");
  }

  const apiResponse = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex,
      method: "POST",
      url: GEMINI_CLI_QUOTA_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({ project }),
    }),
  });

  const json = normalizeApiCallEnvelope(await apiResponse.json());
  const statusCode = json.statusCode;

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`API Error ${getApiCallErrorMessage(json)}`);
  }

  const body = parseJsonMaybe(json.body ?? json.bodyText);
  if (!body || typeof body !== "object") {
    throw new Error("No quota data available");
  }

  const payload = body as Record<string, unknown>;
  const buckets = Array.isArray(payload.buckets) ? buildGeminiCliQuotaBuckets(payload.buckets) : [];
  const supplementary = await fetchGeminiCliCodeAssist(authIndex, project);

  return {
    ...payload,
    buckets,
    ...supplementary,
  };
};
