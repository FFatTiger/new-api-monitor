import { ProgressBar, getProgressTone } from "@/components/quota/progress-bar";
import { formatDateTime, formatPercent } from "@/lib/format";
import {
  computeSubscriptionStats,
  computeUsageShare,
  type SubscriptionRow,
} from "@/lib/queries/subscription-stats";

interface SubscriptionsTableProps {
  rows: SubscriptionRow[];
  now: number; // 当前 Unix 秒，由 page 传入
}

function userLabel(row: SubscriptionRow): string {
  return row.username || (row.userId ? `用户 #${row.userId}` : "未知用户");
}

function formatQuotaCompact(quota: string): string {
  const n = Number(quota);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : quota;
}

export function SubscriptionsTable({ rows, now }: SubscriptionsTableProps) {
  const { totalUsed } = computeSubscriptionStats(rows);
  const leader = rows[0];

  return (
    <section className="ds-panel overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1rem] leading-none tracking-[-0.05em] sm:text-[1.18rem]">
          <span className="ds-tab-active-text text-[var(--foreground)]">订阅消耗</span>
        </div>

        {leader ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem] text-[var(--foreground-soft)]">
            <span>
              榜首 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{userLabel(leader)}</span>
            </span>
            <span>
              已消耗 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatQuotaCompact(leader.amountUsed)}</span>
            </span>
            <span>
              占比{" "}
              <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">
                {formatPercent(computeUsageShare(leader.amountUsed, totalUsed))}
              </span>
            </span>
            <span>
              订阅数 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{rows.length}</span>
            </span>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="py-10 text-center text-[0.86rem] text-[var(--foreground-soft)]">暂无订阅数据</div>
      ) : (
        <div className="ds-table-shell overflow-x-auto">
          <table className="min-w-[1040px] w-full border-collapse text-left text-sm text-[var(--foreground)]">
            <thead>
              <tr className="text-[0.7rem] uppercase tracking-[0.16em] text-[var(--foreground-faint)]">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">套餐</th>
                <th className="px-4 py-3">升级组</th>
                <th className="px-4 py-3 text-right">已消耗</th>
                <th className="px-4 py-3 text-right">剩余</th>
                <th className="px-4 py-3 text-right">消耗占比</th>
                <th className="px-4 py-3">订阅进度</th>
                <th className="px-4 py-3">有效期</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const share = computeUsageShare(row.amountUsed, totalUsed);
                const subPercent = Number(row.amountTotal) > 0
                  ? (Number(row.amountUsed) / Number(row.amountTotal)) * 100
                  : 0;
                const endingSoon = row.endTime ? row.endTime - now < 3 * 24 * 3600 : false;
                const expired = row.endTime ? row.endTime <= now : false;

                return (
                  <tr key={row.id} className="ds-table-row align-top">
                    <td className="px-4 py-3">
                      <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[0.95rem] font-semibold text-[var(--foreground)]">{userLabel(row)}</span>
                    </td>
                    <td className="px-4 py-3 text-[0.82rem] text-[var(--foreground-muted)]">{row.planTitle || "-"}</td>
                    <td className="px-4 py-3 text-[0.82rem] text-[var(--foreground-muted)]">{row.upgradeGroup}</td>
                    <td className="px-4 py-3 text-right ds-mono" title={`quota ${formatQuotaCompact(row.amountUsed)}`}>
                      {formatQuotaCompact(row.amountUsed)}
                    </td>
                    <td className="px-4 py-3 text-right ds-mono text-[var(--foreground-soft)]" title={`quota ${formatQuotaCompact(row.amountRemaining)}`}>
                      {formatQuotaCompact(row.amountRemaining)}
                    </td>
                    <td className="px-4 py-3 text-right ds-mono">{formatPercent(share)}</td>
                    <td className="px-4 py-3 min-w-[8rem]">
                      <ProgressBar
                        percent={subPercent}
                        colorClass={getProgressTone(subPercent / 100)}
                        valueLabel={`${subPercent.toFixed(1)}%`}
                      />
                    </td>
                    <td className="px-4 py-3 text-[0.82rem] text-[var(--foreground-muted)] whitespace-nowrap">
                      <span className={expired ? "text-red-500" : endingSoon ? "text-amber-500" : ""}>
                        {row.endTime ? formatDateTime(row.endTime) : "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[0.82rem]">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[0.7rem]",
                          row.status === "active"
                            ? "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-[var(--background-muted)] text-[var(--foreground-soft)]",
                        ].join(" ")}
                      >
                        {row.status || "-"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
