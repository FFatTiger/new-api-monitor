import { NextRequest, NextResponse } from "next/server";

import { hasValidOAuthAccessKey, OAUTH_ACCESS_HEADER } from "@/lib/oauth/backend";

export const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;

export type OAuthRouteConfig = {
  apiBaseUrl: string;
  apiManagementKey: string;
  oauthAccessKey: string;
};

export function getOAuthRouteConfig(): OAuthRouteConfig {
  return {
    apiBaseUrl: (process.env.API_BASE_URL || "").replace(/\/+$/, ""),
    apiManagementKey: process.env.API_MANAGEMENT_KEY || "",
    oauthAccessKey: process.env.OAUTH_ACCESS_KEY || process.env.API_MANAGEMENT_KEY || "",
  };
}

export function jsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: noStoreHeaders });
}

export function validateOAuthRouteRequest(request: NextRequest): NextResponse | null {
  const { apiBaseUrl, apiManagementKey, oauthAccessKey } = getOAuthRouteConfig();

  if (!apiBaseUrl || !apiManagementKey) {
    return jsonResponse({ error: "Server configuration missing" }, 500);
  }

  if (!oauthAccessKey) {
    return jsonResponse({ error: "OAuth access key missing" }, 500);
  }

  if (!hasValidOAuthAccessKey(request.headers.get(OAUTH_ACCESS_HEADER), oauthAccessKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
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
