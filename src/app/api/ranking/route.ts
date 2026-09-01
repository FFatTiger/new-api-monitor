import { NextRequest, NextResponse } from "next/server";

import { getClickHouseConfig } from "@/lib/clickhouse/config";
import { getClickHouseRankingRows, resolveClickHouseFilters } from "@/lib/clickhouse/query";
import type { SearchParamsInput } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const filterKeys = ["preset", "token", "username", "model", "channelId", "start", "end"] as const;

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "token" && kind !== "user") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400, headers });
  }
  if (!getClickHouseConfig().readsEnabled) {
    return NextResponse.json({ error: "ClickHouse 统计未启用。" }, { status: 503, headers });
  }
  const searchParams: SearchParamsInput = {};
  for (const key of filterKeys) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) searchParams[key] = value;
  }
  try {
    const filters = await resolveClickHouseFilters(searchParams);
    if (!filters) throw new Error("ClickHouse data is not ready");
    if (kind === "token") {
      const tokenRankings = await getClickHouseRankingRows(filters, "token");
      return NextResponse.json({ tokenRankings }, { headers });
    }
    const userRankings = await getClickHouseRankingRows(filters, "user");
    return NextResponse.json({ userRankings }, { headers });
  } catch (error) {
    console.error("[clickhouse-query] ranking failed", error);
    return NextResponse.json(
      { error: "ClickHouse 统计正在同步或暂时不可用；不会回退查询 PostgreSQL 日志。" },
      { status: 503, headers },
    );
  }
}
