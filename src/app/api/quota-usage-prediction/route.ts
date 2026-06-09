import { NextResponse } from "next/server";

import { getQuotaUsagePredictions } from "@/lib/queries/quota-usage-prediction";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const predictions = await getQuotaUsagePredictions();
    return NextResponse.json(
      { predictions },
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
