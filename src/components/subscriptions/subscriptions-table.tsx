import { ProgressBar } from "@/components/quota/progress-bar";
import { formatDateTime, formatPercent, formatUsd, quotaToUsd } from "@/lib/format";
import { computeUsageShare, type UserUsageRow } from "@/lib/queries/subscriptions";

interface SubscriptionsTableProps {
  rows: UserUsageRow[];
  now: number; // 当前 Unix 秒，由 page 传入
}

function userLabel(row: UserUsageRow): string {
  return row.username || (row.userId ? `用户 #${row.userId}` : "未知用户");
}

function formatQuotaCompact(quota: string): string {
  const n = Number(quota);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : quota;
}

export function SubscriptionsTable({ rows }: SubscriptionsTableProps) {
  const leader = rows[0];

  return (
    <section className="ds-panel overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1rem] leading-none tracking-[-0.05em] sm:text-[1.18rem]">
          <span className="ds-tab-active-text text-[var(--foreground)]">用户消耗占比</span>
        </div>

        {leader ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem] text-[var(--foreground-soft)]">
            <span>
              榜首 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{userLabel(leader)}</span>
            </span>
            <span>
              已消耗 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatUsd(quotaToUsd(leader.amountUsed))}</span>
            </span>
            <span>
              占比{" "}
              <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">
                {formatPercent(computeUsageShare(leader.amountUsed, Number(leader.totalUsedQuota)))}
              </span>
            </span>
            <span>
              用户数 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{rows.length}</span>
            </span>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="py-10 text-center text-[0.86rem] text-[var(--foreground-soft)]">暂无订阅数据</div>
      ) : (
        <div className="ds-table-shell overflow-x-auto">
          <table className="min-w-[960px] w-full border-collapse text-left text-sm text-[var(--foreground)]">
            <thead>
              <tr className="text-[0.7rem] uppercase tracking-[0.16em] text-[var(--foreground-faint)]">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">套餐</th>
                <th className="px-4 py-3 text-right">已消耗</th>
                <th className="px-4 py-3">消耗占比</th>
                <th className="px-4 py-3 text-right">订阅数</th>
                <th className="px-4 py-3">到期时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const totalUsed = Number(row.totalUsedQuota);
                const share = computeUsageShare(row.amountUsed, totalUsed);
                return (
                  <tr key={row.userId ?? `row-${index}`} className="ds-table-row align-top">
                    <td className="px-4 py-3">
                      <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[0.95rem] font-semibold text-[var(--foreground)]">{userLabel(row)}</span>
                    </td>
                    <td className="px-4 py-3 text-[0.82rem] text-[var(--foreground-muted)]">{row.plans}</td>
                    <td className="px-4 py-3 text-right ds-mono" title={`quota ${formatQuotaCompact(row.amountUsed)}`}>
                      {formatUsd(quotaToUsd(row.amountUsed))}
                    </td>
                    <td className="px-4 py-3 min-w-[8rem]">
                      <ProgressBar
                        percent={share * 100}
                        colorClass="bg-blue-400/80"
                        valueLabel={formatPercent(share)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right ds-mono text-[var(--foreground-soft)]">{row.subscriptionCount}</td>
                    <td className="px-4 py-3 text-[0.82rem] text-[var(--foreground-muted)] whitespace-nowrap">
                      {row.earliestEnd ? formatDateTime(row.earliestEnd) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--surface-divider)] text-[var(--foreground-soft)]">
                <td className="px-4 py-3" colSpan={3}>
                  <span className="text-[0.78rem] font-medium uppercase tracking-[0.12em]">合计</span>
                </td>
                <td className="px-4 py-3 text-right ds-mono font-semibold text-[var(--foreground)]" title={`quota ${formatQuotaCompact(rows[0]?.totalUsedQuota ?? "0")}`}>
                  {formatUsd(quotaToUsd(rows[0]?.totalUsedQuota ?? "0"))}
                </td>
                <td className="px-4 py-3" colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
