import { NextRequest, NextResponse } from "next/server";

import { extractProjectId, type RawAuthFile } from "@/lib/quota/auth-files";
import { buildQuotaApiCall, findRawAuthFile, type QuotaProxyRequest } from "@/lib/quota/server-proxy";
import { resolveProviderType } from "@/lib/quota/upstream";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const API_MANAGEMENT_KEY = process.env.API_MANAGEMENT_KEY || "";

async function fetchRawAuthFiles(): Promise<RawAuthFile[]> {
  const response = await fetch(`${API_BASE_URL}/auth-files`, {
    headers: {
      Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Failed to fetch auth files for quota proxy", response.status, await response.text());
    throw new Error("Backend request failed");
  }

  const data = (await response.json()) as { files?: RawAuthFile[] };
  return Array.isArray(data.files) ? data.files : [];
}

async function fetchFileContent(name: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth-files/download?name=${encodeURIComponent(name)}`, {
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;
    return JSON.parse((await response.text()).trim());
  } catch {
    return null;
  }
}

function publicError(status = 500) {
  return NextResponse.json(
    { error: "Backend request failed" },
    { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}

export async function POST(request: NextRequest) {
  if (!API_BASE_URL || !API_MANAGEMENT_KEY) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  try {
    const body = (await request.json()) as QuotaProxyRequest;
    const files = await fetchRawAuthFiles();
    const file = findRawAuthFile(files, body.authIndex);
    const fileContent = resolveProviderType(file) === "antigravity" ? await fetchFileContent(file.name) : null;
    const apiCall = buildQuotaApiCall(body, file, fileContent);

    if (resolveProviderType(file) === "antigravity" && fileContent && !extractProjectId(fileContent)) {
      console.warn("Antigravity auth file did not contain a project id", file.name);
    }

    const response = await fetch(`${API_BASE_URL}/api-call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(apiCall),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Failed quota api-call", response.status, text);
      return publicError(response.status);
    }

    const data = await response.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error: unknown) {
    console.error("Failed to proxy quota request", error);
    return publicError();
  }
}
