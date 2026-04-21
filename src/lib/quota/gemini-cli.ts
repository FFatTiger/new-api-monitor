import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";

const extractProjectIdFromAccount = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const matches = Array.from(value.matchAll(/\(([^()]+)\)/g));
  if (matches.length === 0) return null;

  const candidate = matches[matches.length - 1]?.[1]?.trim();
  return candidate ? candidate : null;
};

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
      url: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      header: {
        Authorization: "Bearer $TOKEN$",
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ project }),
    }),
  });

  const json = await apiResponse.json();
  const statusCode = json.statusCode || json.status_code || 0;

  if (statusCode < 200 || statusCode >= 300) {
    const bodyParsed =
      typeof json.body === "string"
        ? (() => {
            try {
              return JSON.parse(json.body);
            } catch {
              return null;
            }
          })()
        : json.body;
    const errorMessage = bodyParsed?.error?.message || bodyParsed?.message || json.bodyText || `HTTP ${statusCode}`;
    throw new Error(`API Error ${statusCode}: ${errorMessage}`);
  }

  let body = json.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body.trim());
    } catch {}
  }

  return body;
};
