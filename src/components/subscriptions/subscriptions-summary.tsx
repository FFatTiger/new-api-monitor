import { ProgressBar } from "@/components/quota/progress-bar";
import { formatUsd, quotaToUsd } from "@/lib/format";
import type { SubscriptionSummary } from "@/lib/queries/subscriptions";

interface SubscriptionsSummaryProps {
  summary: SubscriptionSummary;
}

export function SubscriptionsSummary({ summary }: SubscriptionsSummaryProps) {
  const totalUsed = Number(summary.totalUsedQuota) || 0;
  const totalQuota = Number(summary.totalQuota) || 0;
  const overallPercent = totalQuota > 0 ? (totalUsed / totalQuota) * 100 : 0;

  const cards = [
    { label: "订阅总数", value: String(summary.totalCount), foot: "条", isQuota: false, raw: "" },
    { label: "活跃订阅", value: String(summary.activeCount), foot: "条", isQuota: false, raw: "" },
    { label: "已消耗总额", value: formatUsd(quotaToUsd(totalUsed)), foot: summary.totalUsedQuota, isQuota: true, raw: summary.totalUsedQuota },
    { label: "订阅总额度", value: formatUsd(quotaToUsd(totalQuota)), foot: summary.totalQuota, isQuota: true, raw: summary.totalQuota },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="ds-card space-y-1.5 px-4 py-3 shadow-[0_0_0_1px_var(--surface-ring-soft)]"
          >
            <p className="text-[0.72rem] text-[var(--foreground-soft)]">{c.label}</p>
            <p className="ds-mono text-[1.05rem] font-semibold text-[var(--foreground)]">{c.value}</p>
            {c.isQuota ? (
              <p className="ds-mono text-[0.66rem] text-[var(--foreground-muted)]" title={`quota ${c.raw}`}>
                quota {Number(c.raw).toLocaleString("en-US")}
              </p>
            ) : (
              <p className="text-[0.66rem] text-[var(--foreground-muted)]">{c.foot}</p>
            )}
          </div>
        ))}
      </div>

      <div className="ds-card px-4 py-3 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
        <ProgressBar
          percent={overallPercent}
          label="整体消耗进度（已消耗 / 订阅总额度）"
          valueLabel={`${overallPercent.toFixed(1)}%`}
          colorClass="bg-blue-400/80"
        />
      </div>
    </section>
  );
}
