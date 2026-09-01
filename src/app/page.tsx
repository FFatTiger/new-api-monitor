import { Suspense } from "react";

import { DashboardRefreshBoundary } from "@/components/dashboard/dashboard-refresh-boundary";
import { DashboardContentSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardHeaderControls } from "@/components/dashboard/filters";
import { DashboardRollupStatusPanel } from "@/components/dashboard/rollup-status-panel";
import { StabilitySection } from "@/components/dashboard/stability-section";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { ModelTokenPieChart } from "@/components/dashboard/model-token-pie-chart";
import { TokenRankingTable } from "@/components/dashboard/token-ranking-table";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { AppHeader } from "@/components/navigation/app-header";
import {
  getClickHouseDashboardPacket,
  getClickHouseShellData,
  type ClickHousePacketResult,
} from "@/lib/clickhouse/query";
import { getClickHouseConfig } from "@/lib/clickhouse/config";
import { parseDashboardRouteFilters } from "@/lib/dashboard/dashboard-routing";
import { formatDateTime } from "@/lib/format";
import type { FilterOption, SearchParamsInput } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<SearchParamsInput> };

async function PacketSections({ packetPromise, modelOptions }: { packetPromise: Promise<ClickHousePacketResult>; modelOptions: FilterOption[] }) {
  const packet = await packetPromise;
  if (packet.kind === "error") {
    return <DashboardRollupStatusPanel title="ClickHouse 统计不可用" message={packet.safeMessage} />;
  }
  const { data } = packet;
  return <>
    <SummaryCards summary={data.summary} stabilitySummary={data.stabilitySummary} />
    <TokenRankingTable tokenRows={data.tokenRankings} userRows={data.userRankings} modelRows={data.modelRankings} channelRows={data.channelRankings} modelOptions={modelOptions} />
    <ModelTokenPieChart rows={data.modelRankings} />
    <StabilitySection modelRows={data.modelStability} channelRows={data.channelStability} />
    <UsageTrendChart data={data.trend} granularity={data.granularity} />
  </>;
}

export default async function Home({ searchParams }: PageProps) {
  const resolved = await searchParams;
  const config = getClickHouseConfig();
  const shell = config.readsEnabled ? await getClickHouseShellData(resolved) : null;
  const fallbackFilters = parseDashboardRouteFilters(resolved);
  const filters = shell?.filters ?? fallbackFilters;
  const packetPromise = config.readsEnabled
    ? getClickHouseDashboardPacket(shell?.filters ?? fallbackFilters)
    : null;

  return <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
    <AppHeader
      timestamp={formatDateTime(Math.floor((shell?.generatedAt ?? 0) / 1000))}
      controls={<DashboardHeaderControls filters={filters} usernameOptions={shell?.usernameOptions ?? []} modelOptions={shell?.modelOptions ?? []} channelOptions={shell?.channelOptions ?? []} />}
      subtitle="实时查看调用质量、趋势与配额状态。"
    />
    <DashboardRefreshBoundary fallback={<DashboardContentSkeleton />}>
      {packetPromise ? <Suspense key={JSON.stringify(resolved)} fallback={<DashboardContentSkeleton />}><PacketSections packetPromise={packetPromise} modelOptions={shell?.modelOptions ?? []} /></Suspense>
        : <DashboardRollupStatusPanel title="ClickHouse 统计未启用" message="请先完成历史同步，再启用 CLICKHOUSE_READS_ENABLED。页面不会回退执行 PostgreSQL 原始日志聚合。" />}
    </DashboardRefreshBoundary>
  </main>;
}
