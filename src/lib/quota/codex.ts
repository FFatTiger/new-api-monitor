import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";
import { parseIdTokenPayload } from "@/lib/quota/parse-id-token";
import {
  buildCodexQuotaWindows,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  normalizeCodexPlanType,
  normalizeStringValue,
  parseJsonMaybe,
} from "@/lib/quota/upstream";

const extractAccountId = (value: unknown): string | null => {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;

  const accountId = payload.chatgpt_account_id || payload.chatgptAccountId;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
};

const extractPlanType = (file: AuthFile, payload?: Record<string, unknown>): string | null => {
  const tokenPayload = parseIdTokenPayload(file.idToken);
  return (
    normalizeCodexPlanType(payload?.plan_type ?? payload?.planType) ??
    normalizeCodexPlanType(file.planType ?? file.plan_type) ??
    normalizeCodexPlanType(tokenPayload?.plan_type ?? tokenPayload?.planType)
  );
};

export const fetchCodexQuota = async (file: AuthFile) => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Codex");
  }

  const accountId = extractAccountId(file.idToken);
  if (!accountId) {
    throw new Error("Could not find Chatgpt-Account-Id");
  }

  const apiResponse = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex,
      method: "GET",
      url: CODEX_USAGE_URL,
      header: {
        ...CODEX_REQUEST_HEADERS,
        "Chatgpt-Account-Id": accountId,
      },
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
