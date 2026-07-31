import { ProgressBar } from "@/components/quota/progress-bar";
import { formatPercent } from "@/lib/format";
import {
  computeUsageShare,
  formatQuotaInteger,
  formatQuotaUsd,
} from "@/lib/queries/subscription-stats";
import type { UserUsageRow } from "@/lib/queries/subscriptions";

interface SubscriptionsTableProps {
  rows: UserUsageRow[];
  windowLabel: string;
}

function userLabel(row: UserUsageRow): string {
  return row.username || (row.userId ? `用户 #${row.userId}` : "未知用户");
}

export function SubscriptionsTable({ rows, windowLabel }: SubscriptionsTableProps) {
  const leader = rows[0];

  return (
    <section className="ds-panel overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1rem] leading-none tracking-[-0.05em] sm:text-[1.18rem]">
          <span className="ds-tab-active-text text-[var(--foreground)]">用户所选时间范围订阅消费占比</span>
          <span className="text-[0.72rem] tracking-normal text-[var(--foreground-soft)]">{windowLabel}</span>
        </div>

        {leader ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem] text-[var(--foreground-soft)]">
            <span>
              榜首 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{userLabel(leader)}</span>
            </span>
            <span>
              所选范围消费 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatQuotaUsd(leader.amountUsed)}</span>
            </span>
            <span>
              消费占比{" "}
              <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">
                {formatPercent(computeUsageShare(leader.amountUsed, leader.totalUsedQuota))}
              </span>
            </span>
            <span>
              用户数 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{rows.length}</span>
            </span>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="py-10 text-center text-[0.86rem] text-[var(--foreground-soft)]">所选时间范围暂无订阅消费</div>
      ) : (
        <div className="ds-table-shell overflow-x-auto">
          <table className="min-w-[640px] w-full border-collapse text-left text-sm text-[var(--foreground)]">
            <thead>
              <tr className="text-[0.7rem] uppercase tracking-[0.16em] text-[var(--foreground-faint)]">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3 text-right">所选范围订阅消费</th>
                <th className="px-4 py-3">消费占比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const share = computeUsageShare(row.amountUsed, row.totalUsedQuota);
                return (
                  <tr key={row.userId ?? `row-${index}`} className="ds-table-row align-top">
                    <td className="px-4 py-3">
                      <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[0.95rem] font-semibold text-[var(--foreground)]">{userLabel(row)}</span>
                    </td>
                    <td className="px-4 py-3 text-right ds-mono" title={`quota ${formatQuotaInteger(row.amountUsed)}`}>
                      {formatQuotaUsd(row.amountUsed)}
                    </td>
                    <td className="px-4 py-3 min-w-[8rem]">
                      <ProgressBar
                        percent={share * 100}
                        colorClass="bg-blue-400/80"
                        valueLabel={formatPercent(share)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--surface-divider)] text-[var(--foreground-soft)]">
                <td className="px-4 py-3" colSpan={2}>
                  <span className="text-[0.78rem] font-medium uppercase tracking-[0.12em]">合计</span>
                </td>
                <td className="px-4 py-3 text-right ds-mono font-semibold text-[var(--foreground)]" title={`quota ${formatQuotaInteger(rows[0]?.totalUsedQuota ?? "0")}`}>
                  {formatQuotaUsd(rows[0]?.totalUsedQuota ?? "0")}
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
