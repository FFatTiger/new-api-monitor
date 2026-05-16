import { NextRequest } from "next/server";

import { backendErrorResponse, backendManagementHeaders, getOAuthRouteConfig, jsonResponse, unknownErrorResponse, validateOAuthRouteRequest } from "../_utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authError = validateOAuthRouteRequest(request);
  if (authError) return authError;

  try {
    const state = request.nextUrl.searchParams.get("state")?.trim();
    if (!state) {
      return jsonResponse({ error: "State parameter is required" }, 400);
    }

    const { apiBaseUrl } = getOAuthRouteConfig();
    const response = await fetch(`${apiBaseUrl}/get-auth-status?state=${encodeURIComponent(state)}`, {
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
    return unknownErrorResponse(error);
  }
}
