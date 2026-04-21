import type { AuthFile } from "@/types/auth";

import { apiFetch } from "@/lib/quota/api-client";

export const fetchAntigravityQuota = async (file: AuthFile) => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Antigravity");
  }

  const projectId = file.projectId || "bamboo-precept-lgxtn";
  const urls = [
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  ];
  const requestBodies = [JSON.stringify({ projectId }), JSON.stringify({ project: projectId })];

  let lastError = "";

  for (const url of urls) {
    for (let attempt = 0; attempt < requestBodies.length; attempt += 1) {
      try {
        const apiResponse = await apiFetch("/quota", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authIndex,
            method: "POST",
            url,
            header: {
              Authorization: "Bearer $TOKEN$",
              "Content-Type": "application/json",
              "User-Agent": "antigravity/1.11.5 windows/amd64",
            },
            data: requestBodies[attempt],
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
          lastError = `${statusCode} ${errorMessage}`;

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

        let body = json.body;
        if (typeof body === "string") {
          try {
            body = JSON.parse(body.trim());
          } catch {}
        }

        return body;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError || "Failed to fetch Antigravity quota");
};
