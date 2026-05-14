import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";
import {
  buildCodexQuotaWindows,
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  normalizeCodexPlanType,
  normalizeStringValue,
  parseJsonMaybe,
} from "@/lib/quota/upstream";

const extractPlanType = (file: AuthFile, payload?: Record<string, unknown>): string | null => {
  return (
    normalizeCodexPlanType(payload?.plan_type ?? payload?.planType) ??
    normalizeCodexPlanType(file.planType ?? file.plan_type)
  );
};

export const fetchCodexQuota = async (file: AuthFile) => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Codex");
  }

  const apiResponse = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex,
      provider: "codex",
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
  return {
    ...payload,
    planType: extractPlanType(file, payload),
    plan_type: normalizeStringValue(payload.plan_type ?? payload.planType) ?? extractPlanType(file, payload) ?? undefined,
    windows: buildCodexQuotaWindows(payload),
  };
};
