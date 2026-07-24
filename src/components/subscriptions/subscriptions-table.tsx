import { ProgressBar, getProgressTone } from "@/components/quota/progress-bar";
import { formatDateTime, formatPercent } from "@/lib/format";
import {
  computeSubscriptionStats,
  computeUsageShare,
  type SubscriptionRow,
} from "@/lib/queries/subscription-stats";

interface SubscriptionsGridProps {
  rows: SubscriptionRow[];
  now: number; // 当前 Unix 秒，由 page 传入
}

function userLabel(row: SubscriptionRow): string {
  return row.username || (row.userId ? `用户 #${row.userId}` : "未知用户");
}

function formatQuotaCompact(quota: string): string {
  const n = Number(quota);
  if (!Number.isFinite(n)) return quota;
  return n.toLocaleString("en-US");
}

export function SubscriptionsTable({ rows, now }: SubscriptionsGridProps) {
  const { totalUsed } = computeSubscriptionStats(rows);

  if (rows.length === 0) {
    return (
      <div className="ds-panel flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
        <p className="text-[0.95rem] font-medium text-[var(--foreground)]">暂无订阅数据</p>
        <p className="text-[0.82rem] text-[var(--foreground-soft)]">当前账户下没有任何用户订阅记录。</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => {
        const share = computeUsageShare(row.amountUsed, totalUsed);
        const total = Number(row.amountTotal);
        const used = Number(row.amountUsed);
        const subPercent = total > 0 ? (used / total) * 100 : 0;
        const endingSoon = row.endTime ? row.endTime - now < 3 * 24 * 3600 : false;
        const expired = row.endTime ? row.endTime <= now : false;

        return (
          <article key={row.id} className="ds-card-muted ds-card-interactive flex h-full flex-col p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[0.92rem] font-semibold text-[var(--foreground)]" title={userLabel(row)}>
                  {userLabel(row)}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem]">
                  {row.planTitle ? <span className="ds-pill px-2 py-1 text-[0.66rem]">{row.planTitle}</span> : null}
                  <span className="ds-kicker">{row.upgradeGroup}</span>
                </div>
              </div>
              <span
                className={[
                  "shrink-0 rounded-full px-2 py-0.5 text-[0.66rem]",
                  row.status === "active"
                    ? "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-[var(--background-muted)] text-[var(--foreground-soft)]",
                ].join(" ")}
              >
                {row.status || "-"}
              </span>
            </div>

            <div className="min-h-[72px] flex-1 space-y-3">
              <ProgressBar
                percent={subPercent}
                colorClass={getProgressTone(subPercent / 100)}
                label="订阅消耗进度"
                valueLabel={`${subPercent.toFixed(1)}%`}
              />

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[0.74rem]">
                <div>
                  <p className="text-[var(--foreground-faint)]">已消耗</p>
                  <p className="ds-mono font-medium text-[var(--foreground)]" title={`quota ${formatQuotaCompact(row.amountUsed)}`}>
                    {formatQuotaCompact(row.amountUsed)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--foreground-faint)]">剩余</p>
                  <p className="ds-mono text-[var(--foreground-soft)]" title={`quota ${formatQuotaCompact(row.amountRemaining)}`}>
                    {formatQuotaCompact(row.amountRemaining)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--foreground-faint)]">消耗占比</p>
                  <p className="ds-mono font-medium text-[var(--foreground)]">{formatPercent(share)}</p>
                </div>
                <div>
                  <p className="text-[var(--foreground-faint)]">订阅额度</p>
                  <p className="ds-mono text-[var(--foreground-soft)]" title={`quota ${formatQuotaCompact(row.amountTotal)}`}>
                    {formatQuotaCompact(row.amountTotal)}
                  </p>
                </div>
              </div>
            </div>

            <div className="ds-divider mt-4 pt-3">
              <div className="flex items-center justify-between gap-2 text-[0.68rem]">
                <span className="text-[var(--foreground-faint)]">有效期</span>
                <span
                  className={[
                    "ds-mono whitespace-nowrap",
                    expired ? "text-red-500" : endingSoon ? "text-amber-500" : "text-[var(--foreground-soft)]",
                  ].join(" ")}
                >
                  {row.endTime ? formatDateTime(row.endTime) : "-"}
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
