import { formatQuotaInteger, formatQuotaUsd } from "@/lib/queries/subscription-stats";
import type { SubscriptionSummary } from "@/lib/queries/subscriptions";

interface SubscriptionsSummaryProps {
  summary: SubscriptionSummary;
}

export function SubscriptionsSummary({ summary }: SubscriptionsSummaryProps) {
  const cards = [
    { label: "当前订阅数", value: String(summary.totalCount), foot: "条", isQuota: false, raw: "" },
    { label: "当前活跃订阅", value: String(summary.activeCount), foot: "条", isQuota: false, raw: "" },
    {
      label: "所选时间范围订阅消费",
      value: formatQuotaUsd(summary.totalUsedQuota),
      foot: "quota",
      isQuota: true,
      raw: summary.totalUsedQuota,
    },
  ];

  return (
    <section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {cards.map((c) => (
          <div key={c.label} className="ds-card px-4 py-3 space-y-1.5 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
            <p className="text-[0.72rem] text-[var(--foreground-soft)]">{c.label}</p>
            <p className="ds-mono text-[1.05rem] font-semibold text-[var(--foreground)]">{c.value}</p>
            {c.isQuota ? (
              <p className="ds-mono text-[0.66rem] text-[var(--foreground-muted)]" title={`quota ${c.raw}`}>
                quota {formatQuotaInteger(c.raw)}
              </p>
            ) : (
              <p className="text-[0.66rem] text-[var(--foreground-muted)]">{c.foot}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
