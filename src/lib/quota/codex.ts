import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";
import { parseIdTokenPayload } from "@/lib/quota/parse-id-token";

const extractAccountId = (value: unknown): string | null => {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;

  const accountId = payload.chatgpt_account_id || payload.chatgptAccountId;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
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
      url: "https://chatgpt.com/backend-api/wham/usage",
      header: {
        Authorization: "Bearer $TOKEN$",
        "Content-Type": "application/json",
        "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
        "Chatgpt-Account-Id": accountId,
      },
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
