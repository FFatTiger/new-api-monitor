import { NextRequest, NextResponse } from "next/server";

import { extractProjectId, type RawAuthFile } from "@/lib/quota/auth-files";
import {
  getMiniMaxEndpointCandidates,
  getMiniMaxStatusCode,
  isMiniMaxAuthIndex,
  normalizeMiniMaxApiKey,
  normalizeMiniMaxRegion,
} from "@/lib/quota/minimax";
import { buildQuotaApiCall, findRawAuthFile, type QuotaProxyRequest } from "@/lib/quota/server-proxy";
import { resolveProviderType } from "@/lib/quota/upstream";
import { isZaiAuthIndex, ZAI_USAGE_URL } from "@/lib/quota/zai";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const API_MANAGEMENT_KEY = process.env.API_MANAGEMENT_KEY || "";
const ZAI_API_KEY = process.env.ZAI_API_KEY || process.env.ZAI_API_TOKEN || "";
const MINIMAX_API_KEY = normalizeMiniMaxApiKey(process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || "");
const MINIMAX_API_REGION = process.env.MINIMAX_API_REGION || "auto";
const MINIMAX_API_BASE_URL = process.env.MINIMAX_API_BASE_URL || "";

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

async function fetchZaiQuota() {
  if (!ZAI_API_KEY) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  const response = await fetch(ZAI_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${ZAI_API_KEY}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Failed Z.ai quota request", response.status);
    return publicError(response.status);
  }

  try {
    const data = await response.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error: unknown) {
    console.error("Failed to parse Z.ai quota response", error);
    return publicError();
  }
}

async function fetchMiniMaxQuota() {
  if (!MINIMAX_API_KEY) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  const endpoints = getMiniMaxEndpointCandidates(normalizeMiniMaxRegion(MINIMAX_API_REGION), MINIMAX_API_BASE_URL);
  let lastPayload: Record<string, unknown> | null = null;
  let lastStatus = 500;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${MINIMAX_API_KEY}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) {
        lastStatus = response.status;
        lastPayload = {
          base_resp: {
            status_code: response.status,
            status_msg: `HTTP ${response.status}`,
          },
          endpointRegion: endpoint.region,
        };
        console.error("Failed MiniMax quota request", endpoint.region, response.status);
        continue;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const enrichedPayload = { ...payload, endpointRegion: endpoint.region };
      lastPayload = enrichedPayload;

      const statusCode = getMiniMaxStatusCode(payload);
      if (statusCode === 0) {
        return NextResponse.json(enrichedPayload, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
      }

      if (statusCode !== 1004 || endpoints.length === 1) {
        return NextResponse.json(enrichedPayload, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
      }
    } catch (error: unknown) {
      lastPayload = {
        base_resp: {
          status_code: -1,
          status_msg: "request failed",
        },
        endpointRegion: endpoint.region,
      };
      console.error("Failed MiniMax quota request", endpoint.region, error);
    }
  }

  if (lastPayload) {
    return NextResponse.json(lastPayload, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  }

  return publicError(lastStatus);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as QuotaProxyRequest;
    const requestedProvider = resolveProviderType({ type: body.provider });

    if (requestedProvider === "zai") {
      if (!isZaiAuthIndex(body.authIndex)) {
        return publicError(400);
      }

      return fetchZaiQuota();
    }

    if (requestedProvider === "minimax") {
      if (!isMiniMaxAuthIndex(body.authIndex)) {
        return publicError(400);
      }

      return fetchMiniMaxQuota();
    }

    if (!API_BASE_URL || !API_MANAGEMENT_KEY) {
      return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
    }

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
