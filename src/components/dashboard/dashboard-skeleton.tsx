const summaryCards = [
  { label: "请求数", foot: "请求" },
  { label: "输入令牌", foot: "输入" },
  { label: "输出令牌", foot: "输出" },
  { label: "总令牌", foot: "总计" },
  { label: "输出 tok/s", foot: "tok/s" },
  { label: "活跃用户", foot: "用户" },
  { label: "活跃渠道", foot: "渠道" },
  { label: "平均首 Token 耗时", foot: "s" },
  { label: "平均响应总耗时", foot: "s" },
  { label: "可用率", foot: "成功 / 总请求" },
];

const rankingHeaders = ["#", "密钥", "用户", "请求", "输入", "Cache", "输出", "总令牌", "最近调用"];
const stabilityHeaders = ["#", "模型", "说明", "请求", "错误", "可用率", "首 Token", "总耗时", "输出 tok/s", "最近调用"];

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`ds-skeleton rounded-full ${className}`} />;
}

function SummarySkeleton() {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="ds-kicker">概览</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <article key={card.label} className="ds-card-muted px-4 py-3.5 sm:px-4 sm:py-4">
            <p className="text-[0.68rem] font-medium text-[var(--foreground-soft)]">{card.label}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <SkeletonBlock className="h-6 w-24" />
              <span className="ds-kicker shrink-0 text-[0.58rem] text-[var(--foreground-faint)]">{card.foot}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TableSkeleton({ kind }: { kind: "ranking" | "stability" }) {
  const tabs = kind === "ranking" ? ["密钥排行", "用户排行", "模型排行", "渠道排行"] : ["模型稳定性", "渠道稳定性"];
  const headers = kind === "ranking" ? rankingHeaders : stabilityHeaders;
  const kicker = kind === "ranking" ? "榜首" : "稳定性";

  return (
    <section className="ds-panel overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1rem] leading-none tracking-[-0.05em] sm:text-[1.18rem]">
          {tabs.map((tab, index) => (
            <div key={tab} className="flex items-center gap-x-2 gap-y-1">
              {index > 0 ? <span className="text-[var(--foreground-faint)]">/</span> : null}
              <span className={index === 0 ? "ds-tab-active-text text-[var(--foreground)]" : "font-medium text-[var(--foreground-faint)]"}>{tab}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem] text-[var(--foreground-soft)]">
          <span>{kicker}</span>
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-4 w-20" />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2 md:hidden">
        <div className="space-y-1.5 text-[0.68rem] font-medium text-[var(--foreground-soft)]">
          <span>排序</span>
          <div className="ds-input flex h-10 items-center px-3 text-[0.8rem] text-[var(--foreground)]">{kind === "ranking" ? "总令牌" : "请求"}</div>
        </div>
        <div className="ds-button-secondary flex h-10 items-center justify-center self-end px-3 text-[0.79rem] font-medium">降序</div>
      </div>

      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <article key={index} className="ds-mobile-row p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                  <SkeletonBlock className="h-4 w-36" />
                </div>
                <SkeletonBlock className="mt-2 h-3 w-24" />
              </div>
              <div className="shrink-0 text-right">
                <p className="ds-kicker text-[0.56rem] text-[var(--foreground-faint)]">{kind === "ranking" ? "总令牌" : "可用率"}</p>
                <SkeletonBlock className="mt-2 h-5 w-16" />
              </div>
            </div>
            <div className="ds-mobile-meta mt-3 grid grid-cols-2 gap-2 pt-3">
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="ml-auto h-4 w-24" />
              <SkeletonBlock className="h-4 w-28" />
              <SkeletonBlock className="ml-auto h-4 w-20" />
            </div>
          </article>
        ))}
      </div>

      <div className="hidden md:block">
        <div className="ds-table-shell overflow-x-auto">
          <table className="min-w-[1160px] w-full border-collapse text-left text-sm text-[var(--foreground)]">
            <thead>
              <tr className="text-[0.7rem] uppercase tracking-[0.16em] text-[var(--foreground-faint)]">
                {headers.map((header, index) => (
                  <th key={header} className={`px-4 py-3 ${index >= 3 && header !== "最近调用" ? "text-right" : "text-left"}`}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, rowIndex) => (
                <tr key={rowIndex} className="ds-table-row align-top">
                  {headers.map((header, columnIndex) => (
                    <td key={header} className={`px-4 py-3 ${columnIndex >= 3 && header !== "最近调用" ? "text-right" : "text-left"}`}>
                      {columnIndex === 0 ? <span className="ds-table-rank">#{String(rowIndex + 1).padStart(2, "0")}</span> : <SkeletonBlock className={`h-4 ${columnIndex <= 2 ? "w-28" : "ml-auto w-16"}`} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TrendSkeleton() {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <p className="ds-kicker">趋势</p>
          <h2 className="mt-3 text-[1.16rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)] sm:text-[1.45rem]">令牌趋势</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="ds-pill inline-flex items-center gap-2 px-3 py-2 ds-kicker text-[0.58rem] text-[var(--foreground-faint)]"><span className="h-2 w-2 rounded-full bg-[#2563eb]" />输入</span>
          <span className="ds-pill inline-flex items-center gap-2 px-3 py-2 ds-kicker text-[0.58rem] text-[var(--foreground-faint)]"><span className="h-2 w-2 rounded-full bg-[#d97706]" />输出</span>
          <span className="ds-pill inline-flex items-center gap-2 px-3 py-2 ds-kicker text-[0.58rem] text-[var(--foreground-faint)]"><span className="h-2 w-2 rounded-full bg-[var(--foreground-faint)]" />总令牌</span>
        </div>
      </div>
      <div className="h-60 rounded-[18px] bg-[var(--background-elevated)] p-4 shadow-[0_0_0_1px_var(--surface-ring-soft)] sm:h-72">
        <div className="flex h-full flex-col justify-between">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} className="h-2 w-full" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function DashboardContentSkeleton() {
  return (
    <div className="flex flex-col gap-8 sm:gap-10" aria-busy="true" aria-label="数据刷新中">
      <SummarySkeleton />
      <TableSkeleton kind="ranking" />
      <TableSkeleton kind="stability" />
      <TrendSkeleton />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <DashboardContentSkeleton />
    </main>
  );
}
