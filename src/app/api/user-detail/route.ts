import { NextRequest, NextResponse } from "next/server";

import { getClickHouseConfig } from "@/lib/clickhouse/config";
import { getClickHouseUserDetail, resolveClickHouseFilters } from "@/lib/clickhouse/query";
import type { SearchParamsInput } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest) {
  const userId = Number(request.nextUrl.searchParams.get("userId") || "0");
  const username = request.nextUrl.searchParams.get("username") || "";
  if (!Number.isFinite(userId) || !username) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400, headers });
  }
  if (!getClickHouseConfig().readsEnabled) {
    return NextResponse.json({ error: "ClickHouse 统计未启用。" }, { status: 503, headers });
  }
  const searchParams: SearchParamsInput = {};
  for (const key of ["preset", "token", "username", "model", "channelId", "start", "end"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) searchParams[key] = value;
  }
  try {
    const filters = await resolveClickHouseFilters(searchParams);
    if (!filters) throw new Error("ClickHouse data is not ready");
    const detail = await getClickHouseUserDetail(filters, userId, username);
    return NextResponse.json({ detail }, { headers });
  } catch (error) {
    console.error("[clickhouse-query] user detail failed", error);
    return NextResponse.json(
      { error: "ClickHouse 统计正在同步或暂时不可用；不会回退查询 PostgreSQL 日志。" },
      { status: 503, headers },
    );
  }
}
