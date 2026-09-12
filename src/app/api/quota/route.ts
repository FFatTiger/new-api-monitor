import { NextRequest, NextResponse } from "next/server";

import { fetchQuotaForAuthFileOnServer } from "@/lib/quota/server-fetch";
import { listServerAuthFiles } from "@/lib/quota/server-auth-files";
import { resolveProviderType } from "@/lib/quota/upstream";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type QuotaRequest = { authIndex?: unknown; provider?: unknown };

function publicError(status = 500) {
  return NextResponse.json(
    { error: "Quota request failed" },
    { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as QuotaRequest;
    const authIndex = String(body.authIndex ?? "").trim();
    if (!authIndex) return publicError(400);

    const { files, rawFiles, config } = await listServerAuthFiles();
    const file = files.find((candidate) => candidate.authIndex === authIndex);
    if (!file || resolveProviderType(file) !== resolveProviderType({ type: body.provider })) {
      return publicError(400);
    }

    const data = await fetchQuotaForAuthFileOnServer(file, { config, rawFiles });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    console.error("Failed direct quota request", error);
    return publicError();
  }
}
