import { DashboardHeaderControls } from "@/components/dashboard/filters";
import { StabilitySection } from "@/components/dashboard/stability-section";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="ds-wordmark">NEW-API-MONITOR</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <div className="rounded-[12px] bg-[var(--background-elevated)] px-3 py-2 shadow-[0_0_0_1px_var(--surface-ring)]">
            <p className="ds-mono text-[0.8rem] text-[var(--foreground-muted)] sm:text-[0.84rem]">
              {formatDateTime(Math.floor(data.generatedAt / 1000))}
            </p>
          </div>
          <ThemeToggle />
          <DashboardHeaderControls
            filters={data.filters}
            usernameOptions={data.usernameOptions}
            modelOptions={data.modelOptions}
            channelOptions={data.channelOptions}
          />
        </div>
      </header>

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
