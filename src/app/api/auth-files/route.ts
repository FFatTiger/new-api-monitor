import { NextResponse } from "next/server";

import { buildMiniMaxAuthFile, buildZaiAuthFile, extractProjectId, sanitizeAuthFile, type RawAuthFile } from "@/lib/quota/auth-files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const API_MANAGEMENT_KEY = process.env.API_MANAGEMENT_KEY || "";
const ZAI_API_KEY = process.env.ZAI_API_KEY || process.env.ZAI_API_TOKEN || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || "";
const MINIMAX_API_REGION = process.env.MINIMAX_API_REGION || "auto";

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

    const text = await response.text();
    return JSON.parse(text.trim());
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

export async function GET() {
  const serverAuthFiles = [
    buildZaiAuthFile(ZAI_API_KEY),
    buildMiniMaxAuthFile(MINIMAX_API_KEY, MINIMAX_API_REGION),
  ].filter((file): file is NonNullable<typeof file> => Boolean(file));

  if (!API_BASE_URL || !API_MANAGEMENT_KEY) {
    if (serverAuthFiles.length) {
      return NextResponse.json(
        { files: serverAuthFiles },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
      );
    }

    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth-files`, {
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Failed to fetch auth files", response.status, await response.text());
      return publicError(response.status);
    }

    const data = (await response.json()) as { files?: RawAuthFile[] };
    if (!Array.isArray(data.files)) {
      return NextResponse.json(
        { files: serverAuthFiles },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
      );
    }

    const sanitizedFiles = await Promise.all(
      data.files.map(async (file) => {
        const type = (file.type || file.provider || "").toLowerCase();
        const isAntigravity = type.includes("antigravity");

        let projectId: string | null = null;
        if (isAntigravity) {
          const content = await fetchFileContent(file.name);
          projectId = content ? extractProjectId(content) || "bamboo-precept-lgxtn" : "bamboo-precept-lgxtn";
        }

        return sanitizeAuthFile(file, projectId);
      }),
    );

    return NextResponse.json(
      { files: [...sanitizedFiles, ...serverAuthFiles] },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error: unknown) {
    console.error("Failed to serve auth files", error);
    return publicError();
  }
}
