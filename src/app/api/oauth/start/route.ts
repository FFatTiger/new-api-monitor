import { NextRequest } from "next/server";

import { buildOAuthStartBackendRequest } from "@/lib/oauth/backend";

import { backendErrorResponse, backendManagementHeaders, getOAuthRouteConfig, jsonResponse, unknownErrorResponse, validateOAuthRouteRequest } from "../_utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const authError = validateOAuthRouteRequest();
  if (authError) return authError;

  try {
    const body = (await request.json()) as { provider?: unknown; projectId?: unknown };
    const { apiBaseUrl } = getOAuthRouteConfig();
    const backendRequest = buildOAuthStartBackendRequest(apiBaseUrl, body.provider, body.projectId);

    const response = await fetch(backendRequest.url, {
      method: "GET",
      headers: backendManagementHeaders(),
      cache: "no-store",
    });

    if (!response.ok) {
      return backendErrorResponse(response);
    }

    const data = await response.json();
    return jsonResponse(data);
  } catch (error: unknown) {
    const status = error instanceof Error && error.message === "Invalid provider" ? 400 : 500;
    if (status === 400) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Invalid provider" }, status);
    }
    return unknownErrorResponse(error);
  }
}
