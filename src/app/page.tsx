import { Suspense } from "react";

import { DashboardRefreshBoundary } from "@/components/dashboard/dashboard-refresh-boundary";
import { DashboardContentSkeleton, SummarySkeleton, TableSkeleton, TrendSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardHeaderControls } from "@/components/dashboard/filters";
import { StabilitySection } from "@/components/dashboard/stability-section";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { TokenRankingTable } from "@/components/dashboard/token-ranking-table";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { AppHeader } from "@/components/navigation/app-header";
import { formatDateTime } from "@/lib/format";
import {
  getDashboardRankingData,
  getDashboardShellData,
  getDashboardStabilityData,
  getDashboardSummaryData,
  getDashboardTrendData,
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

export default async function Home({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const shell = await getDashboardShellData(resolvedSearchParams);
  const suspenseKey = JSON.stringify(resolvedSearchParams);

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
      </DashboardRefreshBoundary>
    </main>
  );
}
