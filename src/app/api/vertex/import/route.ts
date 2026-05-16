import { NextRequest } from "next/server";

import { backendErrorResponse, getOAuthRouteConfig, jsonResponse, unknownErrorResponse, validateOAuthRouteRequest } from "../../oauth/_utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const authError = validateOAuthRouteRequest();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const location = formData.get("location");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "File is required" }, 400);
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
      return jsonResponse({ error: "Only JSON files are allowed" }, 400);
    }

    const backendFormData = new FormData();
    backendFormData.append("file", file);
    if (typeof location === "string" && location.trim()) {
      backendFormData.append("location", location.trim());
    }

    const { apiBaseUrl, apiManagementKey } = getOAuthRouteConfig();
    const response = await fetch(`${apiBaseUrl}/vertex/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiManagementKey}`,
      },
      cache: "no-store",
      body: backendFormData,
    });

    if (!response.ok) {
      return backendErrorResponse(response);
    }

    const data = await response.json();
    return jsonResponse({
      status: "ok",
      projectId: data.project_id ?? data.projectId,
      email: data.email,
      location: data.location,
      authFile: data["auth-file"] || data.auth_file || data.authFile ? "saved" : undefined,
    });
  } catch (error: unknown) {
    return unknownErrorResponse(error);
  }
}
