import { Suspense } from "react";

import { DashboardRefreshBoundary } from "@/components/dashboard/dashboard-refresh-boundary";
import { DashboardContentSkeleton, SummarySkeleton, TableSkeleton, TrendSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardHeaderControls } from "@/components/dashboard/filters";
import { DashboardRollupStatusPanel } from "@/components/dashboard/rollup-status-panel";
import { StabilitySection } from "@/components/dashboard/stability-section";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { TokenRankingTable } from "@/components/dashboard/token-ranking-table";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { AppHeader } from "@/components/navigation/app-header";
import {
  getDashboardRollupPacket,
  type DashboardRollupPacketResult,
  type DashboardRollupQueryPlan,
} from "@/lib/dashboard/rollup-query";
import { formatDateTime } from "@/lib/format";
import {
  getDashboardRankingData,
  getDashboardShellData,
  getDashboardStabilityData,
  getDashboardSummaryData,
  getDashboardTrendData,
  resolveDashboardQueryPlan,
  type SearchParamsInput,
} from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<SearchParamsInput>;
};

async function SummarySection({ filters }: { filters: Awaited<ReturnType<typeof getDashboardShellData>>["filters"] }) {
  const data = await getDashboardSummaryData(filters);
  return <SummaryCards summary={data.summary} stabilitySummary={data.stabilitySummary} />;
}

async function RankingSection({ filters }: { filters: Awaited<ReturnType<typeof getDashboardShellData>>["filters"] }) {
  const data = await getDashboardRankingData(filters);
  return (
    <TokenRankingTable
      tokenRows={data.tokenRankings}
      userRows={data.userRankings}
      modelRows={data.modelRankings}
      channelRows={data.channelRankings}
    />
  );
}

async function StabilityDataSection({ filters }: { filters: Awaited<ReturnType<typeof getDashboardShellData>>["filters"] }) {
  const data = await getDashboardStabilityData(filters);
  return <StabilitySection modelRows={data.modelStability} channelRows={data.channelStability} />;
}

async function TrendSection({ filters }: { filters: Awaited<ReturnType<typeof getDashboardShellData>>["filters"] }) {
  const data = await getDashboardTrendData(filters);
  return <UsageTrendChart data={data.trend} granularity={data.granularity} />;
}

async function RollupPacketSections({
  packetPromise,
}: {
  packetPromise: Promise<DashboardRollupPacketResult>;
}) {
  const packet = await packetPromise;
  if (packet.kind === "error") {
    return (
      <DashboardRollupStatusPanel
        title="长期统计读取失败"
        message={packet.safeMessage}
        processedRows={0}
      />
    );
  }

  const { data } = packet;
  return (
    <>
      <SummaryCards summary={data.summary} stabilitySummary={data.stabilitySummary} />
      <TokenRankingTable
        tokenRows={data.tokenRankings}
        userRows={data.userRankings}
        modelRows={data.modelRankings}
        channelRows={data.channelRankings}
      />
      <StabilitySection modelRows={data.modelStability} channelRows={data.channelStability} />
      <UsageTrendChart data={data.trend} granularity={data.granularity} />
    </>
  );
}

export default async function Home({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const plan = await resolveDashboardQueryPlan(resolvedSearchParams);
  const shell = await getDashboardShellData(resolvedSearchParams, plan);
  const suspenseKey = JSON.stringify(resolvedSearchParams);

  // Ready 30d/all: create exactly one request-local packet promise.
  const packetPromise =
    plan.kind === "rollup"
      ? getDashboardRollupPacket(plan as DashboardRollupQueryPlan)
      : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AppHeader
        timestamp={formatDateTime(Math.floor(shell.generatedAt / 1000))}
        controls={
          <DashboardHeaderControls
            filters={shell.filters}
            usernameOptions={shell.usernameOptions}
            modelOptions={shell.modelOptions}
            channelOptions={shell.channelOptions}
          />
        }
        subtitle="实时查看调用质量、趋势与配额状态。"
      />

      <DashboardRefreshBoundary fallback={<DashboardContentSkeleton />}>
        {plan.kind === "unavailable" ? (
          <DashboardRollupStatusPanel readiness={plan.readiness} />
        ) : plan.kind === "rollup" && packetPromise ? (
          <Suspense key={`rollup-${suspenseKey}`} fallback={<DashboardContentSkeleton />}>
            <RollupPacketSections packetPromise={packetPromise} />
          </Suspense>
        ) : (
          <>
            <Suspense key={`summary-${suspenseKey}`} fallback={<SummarySkeleton />}>
              <SummarySection filters={shell.filters} />
            </Suspense>

            <Suspense key={`ranking-${suspenseKey}`} fallback={<TableSkeleton kind="ranking" />}>
              <RankingSection filters={shell.filters} />
            </Suspense>

            <Suspense key={`stability-${suspenseKey}`} fallback={<TableSkeleton kind="stability" />}>
              <StabilityDataSection filters={shell.filters} />
            </Suspense>

            <Suspense key={`trend-${suspenseKey}`} fallback={<TrendSkeleton />}>
              <TrendSection filters={shell.filters} />
            </Suspense>
          </>
        )}
      </DashboardRefreshBoundary>
    </main>
  );
}
