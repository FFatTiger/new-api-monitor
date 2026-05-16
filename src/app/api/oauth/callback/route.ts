import { NextRequest } from "next/server";

import { getCallbackBackendProvider } from "@/lib/oauth/backend";

import { backendErrorResponse, backendManagementHeaders, getOAuthRouteConfig, jsonResponse, unknownErrorResponse, validateOAuthRouteRequest } from "../_utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CallbackRequestBody = {
  provider?: unknown;
  redirectUrl?: unknown;
  code?: unknown;
  state?: unknown;
  error?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const authError = validateOAuthRouteRequest();
  if (authError) return authError;

  try {
    const body = (await request.json()) as CallbackRequestBody;
    const backendProvider = getCallbackBackendProvider(body.provider);
    const redirectUrl = stringValue(body.redirectUrl);
    const code = stringValue(body.code);
    const state = stringValue(body.state);
    const errorMessage = stringValue(body.error);

    if (!redirectUrl && !code && !errorMessage) {
      return jsonResponse({ error: "redirectUrl, code, or error is required" }, 400);
    }

    const { apiBaseUrl } = getOAuthRouteConfig();
    const response = await fetch(`${apiBaseUrl}/oauth-callback`, {
      method: "POST",
      headers: backendManagementHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        provider: backendProvider,
        redirect_url: redirectUrl,
        code,
        state,
        error: errorMessage,
      }),
    });

    if (!response.ok) {
      return backendErrorResponse(response);
    }

    const data = await response.json();
    return jsonResponse(data);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Invalid provider" || error.message === "Provider does not support callback submission")) {
      return jsonResponse({ error: error.message }, 400);
    }
    return unknownErrorResponse(error);
  }
}
