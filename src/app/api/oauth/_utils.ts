import { NextResponse } from "next/server";

import { hasOAuthBackendCredentials } from "@/lib/oauth/backend";

export const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;

export type OAuthRouteConfig = {
  apiBaseUrl: string;
  apiManagementKey: string;
};

export function getOAuthRouteConfig(): OAuthRouteConfig {
  return {
    apiBaseUrl: (process.env.API_BASE_URL || "").replace(/\/+$/, ""),
    apiManagementKey: process.env.API_MANAGEMENT_KEY || "",
  };
}

export function jsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: noStoreHeaders });
}

export function validateOAuthRouteRequest(): NextResponse | null {
  const { apiBaseUrl, apiManagementKey } = getOAuthRouteConfig();

  if (!hasOAuthBackendCredentials(apiBaseUrl, apiManagementKey)) {
    return jsonResponse({ error: "Server configuration missing" }, 500);
  }

  return null;
}

export function backendManagementHeaders() {
  const { apiManagementKey } = getOAuthRouteConfig();
  return {
    Authorization: `Bearer ${apiManagementKey}`,
    "Content-Type": "application/json",
  };
}

export async function backendErrorResponse(response: Response) {
  const text = await response.text();
  return jsonResponse({ error: `Backend error: ${response.status} ${text}` }, response.status);
}

export function unknownErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return jsonResponse({ error: message }, 500);
}
