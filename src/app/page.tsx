import { DimensionTabs } from "@/components/dashboard/dimension-tabs";
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
    <main className="mx-auto flex min-h-screen w-full max-w-[1720px] flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4 lg:px-6 lg:py-5">
      <header className="flex flex-col gap-2 px-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <span className="inline-flex h-8 items-center rounded-[0.8rem] border border-cyan-300/18 bg-cyan-300/[0.06] px-3 [font-family:var(--font-code)] text-[0.64rem] font-semibold tracking-[0.06em] text-cyan-200 sm:rounded-[0.85rem] sm:text-[0.68rem] sm:tracking-[0.08em]">
            NEW-API-MONITOR
          </span>
        </div>
        <p className="[font-family:var(--font-code)] text-[0.64rem] uppercase tracking-[0.16em] text-slate-500 sm:text-[0.68rem] sm:tracking-[0.22em]">
          最近同步 {formatDateTime(Math.floor(data.generatedAt / 1000))}
        </p>
      </header>

      <SummaryCards
        summary={data.summary}
        windowLabel={data.filters.windowLabel}
        filters={data.filters}
        usernameOptions={data.usernameOptions}
        modelOptions={data.modelOptions}
        channelOptions={data.channelOptions}
      />

      <TokenRankingTable rows={data.tokenRankings} />

      <UsageTrendChart data={data.trend} granularity={data.filters.granularity} />

      <DimensionTabs users={data.userRankings} models={data.modelRankings} channels={data.channelRankings} />
    </main>
  );
}
