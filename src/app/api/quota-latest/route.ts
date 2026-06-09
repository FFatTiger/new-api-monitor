import { NextResponse } from "next/server";

import { buildQuotaStatesFromLatestRows, getQuotaLatestRows } from "@/lib/queries/quota-latest";
import { listServerAuthFiles } from "@/lib/quota/server-auth-files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { files } = await listServerAuthFiles();
    const rows = files.length ? await getQuotaLatestRows(files.map((file) => file.authIndex)) : [];
    const quotas = buildQuotaStatesFromLatestRows(files, rows);

    return NextResponse.json(
      { files, quotas },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error: unknown) {
    console.error("Failed to serve cached quota data", error);
    return NextResponse.json(
      { error: "Failed to serve cached quota data" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
