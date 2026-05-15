import { NextRequest, NextResponse } from "next/server";

import { getTokenDetailData, type SearchParamsInput } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenId = Number(searchParams.get("tokenId") || "0");
  const tokenName = searchParams.get("tokenName") || "";

  if (!Number.isFinite(tokenId) || !tokenName) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const filters: SearchParamsInput = {};
  for (const key of ["preset", "token", "username", "model", "channelId", "start", "end"]) {
    const value = searchParams.get(key);
    if (value !== null) filters[key] = value;
  }

  try {
    const detail = await getTokenDetailData(filters, tokenId, tokenName);
    return NextResponse.json({ detail }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error: unknown) {
    console.error("Failed to fetch token detail", error);
    return NextResponse.json(
      { error: "Failed to fetch token detail" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
