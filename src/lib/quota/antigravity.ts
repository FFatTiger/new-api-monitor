import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  buildAntigravityQuotaGroups,
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  parseJsonMaybe,
} from "@/lib/quota/upstream";

export const fetchAntigravityQuota = async (file: AuthFile) => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Antigravity");
  }

  const projectId = file.projectId || "bamboo-precept-lgxtn";
  const requestBodies = [JSON.stringify({ project: projectId }), JSON.stringify({ projectId })];

  let lastError = "";

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    for (let attempt = 0; attempt < requestBodies.length; attempt += 1) {
      try {
        const apiResponse = await apiFetch("/quota", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authIndex,
            method: "POST",
            url,
            header: { ...ANTIGRAVITY_REQUEST_HEADERS },
            data: requestBodies[attempt],
          }),
        });

        const json = normalizeApiCallEnvelope(await apiResponse.json());
        const statusCode = json.statusCode;

        if (statusCode < 200 || statusCode >= 300) {
          const errorMessage = getApiCallErrorMessage(json);
          lastError = errorMessage;

          if (statusCode === 400) {
            const normalizedError = String(errorMessage).toLowerCase();
            if (
              normalizedError.includes("unknown name") &&
              normalizedError.includes("cannot find field") &&
              attempt < requestBodies.length - 1
            ) {
              continue;
            }
          }

          if (statusCode === 403 || statusCode === 404) {
            break;
          }

          continue;
        }

        const body = parseJsonMaybe(json.body ?? json.bodyText);
        const payload =
          body && typeof body === "object" && "models" in body
            ? (body as Record<string, unknown>)
            : body && typeof body === "object" && "body" in body
              ? (parseJsonMaybe((body as Record<string, unknown>).body) as Record<string, unknown> | null)
              : null;
        const models = payload?.models;

        if (!models || typeof models !== "object" || Array.isArray(models)) {
          lastError = "No quota data available";
          continue;
        }

        return {
          ...payload,
          groups: buildAntigravityQuotaGroups(models as Parameters<typeof buildAntigravityQuotaGroups>[0]),
        };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError || "Failed to fetch Antigravity quota");
};
