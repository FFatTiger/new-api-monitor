import { formatCompactNumber, formatInteger } from "@/lib/format";
import type { SummaryMetrics } from "@/lib/queries/dashboard";

interface SummaryCardsProps {
  summary: SummaryMetrics;
}

const cards: Array<{
  key: keyof SummaryMetrics;
  label: string;
  foot: string;
  format: (value: number) => string;
  valueClassName: string;
}> = [
  {
    key: "requestCount",
    label: "请求数",
    foot: "请求",
    format: formatInteger,
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "totalTokens",
    label: "令牌消耗",
    foot: "令牌",
    format: formatCompactNumber,
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "activeTokenCount",
    label: "活跃密钥",
    foot: "密钥",
    format: formatInteger,
    valueClassName: "text-[var(--foreground-muted)]",
  },
  {
    key: "activeUserCount",
    label: "活跃用户",
    foot: "用户",
    format: formatInteger,
    valueClassName: "text-[var(--foreground-muted)]",
  },
  {
    key: "activeChannelCount",
    label: "活跃渠道",
    foot: "渠道",
    format: formatInteger,
    valueClassName: "text-[var(--foreground-muted)]",
  },
];

export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="ds-kicker">概览</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {cards.map((card) => {
          const value = summary[card.key];

          return (
            <article key={card.key} className="ds-card-muted px-4 py-3.5 sm:px-4 sm:py-4">
              <p className="text-[0.68rem] font-medium text-[var(--foreground-soft)]">{card.label}</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <p
                  className={`ds-mono text-[1.18rem] font-semibold leading-none tracking-[-0.07em] sm:text-[1.45rem] ${card.valueClassName}`}
                >
                  {card.format(value)}
                </p>
                <span className="ds-kicker shrink-0 text-[0.58rem] text-[var(--foreground-faint)]">{card.foot}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
