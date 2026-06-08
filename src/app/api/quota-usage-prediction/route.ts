import { NextRequest, NextResponse } from "next/server";

import { getQuotaUsagePredictions } from "@/lib/queries/quota-usage-prediction";
import { normalizeQuotaUsageWindowMinutes } from "@/lib/quota/usage-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const windowMinutes = normalizeQuotaUsageWindowMinutes(request.nextUrl.searchParams.get("windowMinutes"));
    const predictions = await getQuotaUsagePredictions(windowMinutes);
    return NextResponse.json(
      { predictions, windowMinutes },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error: unknown) {
    console.error("Failed to fetch quota usage predictions", error);
    return NextResponse.json(
      { error: "Failed to fetch quota usage predictions" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
