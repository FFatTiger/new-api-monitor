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

  return (
    <section className="ds-card overflow-hidden shadow-[0_0_0_1px_var(--surface-ring-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.8rem]">
          <thead>
            <tr className="border-b border-[var(--surface-divider)] bg-[var(--background-muted)] text-left text-[var(--foreground-soft)]">
              <th className="px-3 py-2.5 font-medium">用户</th>
              <th className="px-3 py-2.5 font-medium">套餐</th>
              <th className="px-3 py-2.5 font-medium">升级组</th>
              <th className="px-3 py-2.5 text-right font-medium">已消耗</th>
              <th className="px-3 py-2.5 text-right font-medium">剩余</th>
              <th className="px-3 py-2.5 text-right font-medium">消耗占比</th>
              <th className="px-3 py-2.5 font-medium">订阅进度</th>
              <th className="px-3 py-2.5 font-medium">有效期</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = computeUsageShare(row.amountUsed, totalUsed);
              const subPercent = Number(row.amountTotal) > 0
                ? (Number(row.amountUsed) / Number(row.amountTotal)) * 100
                : 0;
              const endingSoon = row.endTime ? row.endTime - now < 3 * 24 * 3600 : false;

              return (
                <tr key={row.id} className="border-b border-[var(--surface-divider-soft)] last:border-0">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-[var(--foreground)]">{userLabel(row)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--foreground-soft)]">{row.planTitle || "-"}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-[var(--background-muted)] px-2 py-0.5 text-[0.7rem] text-[var(--foreground-soft)]">
                      {row.upgradeGroup}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono font-medium" title={`quota ${formatQuotaCompact(row.amountUsed)}`}>
                    {formatQuotaCompact(row.amountUsed)}
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono text-[var(--foreground-soft)]" title={`quota ${formatQuotaCompact(row.amountRemaining)}`}>
                    {formatQuotaCompact(row.amountRemaining)}
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono font-medium">{formatPercent(share)}</td>
                  <td className="px-3 py-2.5 min-w-[8rem]">
                    <ProgressBar
                      percent={subPercent}
                      colorClass={getProgressTone(subPercent / 100)}
                      valueLabel={`${subPercent.toFixed(1)}%`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-[var(--foreground-soft)]">
                    <span className={endingSoon ? "text-red-500" : ""}>
                      {row.startTime ? formatDateTime(row.startTime) : "-"} ~ {row.endTime ? formatDateTime(row.endTime) : "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[var(--foreground-soft)]">
                  暂无订阅数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
