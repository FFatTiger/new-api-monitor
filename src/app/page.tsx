import { AppHeader } from "@/components/navigation/app-header";
import { DashboardHeaderControls } from "@/components/dashboard/filters";
import { StabilitySection } from "@/components/dashboard/stability-section";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { TokenRankingTable } from "@/components/dashboard/token-ranking-table";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { formatDateTime } from "@/lib/format";
import { getDashboardData, type SearchParamsInput } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<SearchParamsInput>;
};

export default async function Home({ searchParams }: PageProps) {
  const data = await getDashboardData(await searchParams);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AppHeader
        timestamp={formatDateTime(Math.floor(data.generatedAt / 1000))}
        controls={
          <DashboardHeaderControls
            filters={data.filters}
            usernameOptions={data.usernameOptions}
            modelOptions={data.modelOptions}
            channelOptions={data.channelOptions}
          />
        }
        subtitle="实时查看调用质量、趋势与配额状态。"
      />

      <SummaryCards summary={data.summary} stabilitySummary={data.stabilitySummary} />

      <TokenRankingTable
        tokenRows={data.tokenRankings}
        userRows={data.userRankings}
        modelRows={data.modelRankings}
        channelRows={data.channelRankings}
      />

      <StabilitySection modelRows={data.modelStability} channelRows={data.channelStability} />

      <UsageTrendChart data={data.trend} granularity={data.filters.granularity} />
    </main>
  );
}
