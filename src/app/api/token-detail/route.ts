import { NextRequest, NextResponse } from "next/server";

import { runTokenDetailRequest } from "@/lib/dashboard/dashboard-routing";
import { getDashboardRollupTokenDetail } from "@/lib/dashboard/rollup-query";
import {
  getTokenDetailData,
  resolveDashboardQueryPlan,
  type SearchParamsInput,
} from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenId = Number(searchParams.get("tokenId") || "0");
  const tokenName = searchParams.get("tokenName") || "";

  const filters: SearchParamsInput = {};
  for (const key of ["preset", "token", "username", "model", "channelId", "start", "end"]) {
    const value = searchParams.get(key);
    if (value !== null) filters[key] = value;
  }

  const result = await runTokenDetailRequest(
    { tokenId, tokenName, filters },
    {
      resolvePlan: resolveDashboardQueryPlan,
      getLegacyDetail: getTokenDetailData,
      getRollupDetail: getDashboardRollupTokenDetail,
      logError: (error) => {
        console.error("Failed to fetch token detail", error);
      },
    },
  );

  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
