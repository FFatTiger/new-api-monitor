import {
  formatCompactNumber,
  formatDurationMsAsSeconds,
  formatDurationSeconds,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import type { StabilitySummary, SummaryMetrics } from "@/lib/queries/dashboard";

interface SummaryCardsProps {
  summary: SummaryMetrics;
  stabilitySummary: StabilitySummary;
}

const cards: Array<{
  key: string;
  label: string;
  foot: string;
  getValue: (summary: SummaryMetrics, stabilitySummary: StabilitySummary) => number | null;
  format: (value: number | null) => string;
  valueClassName: string;
}> = [
  {
    key: "requestCount",
    label: "请求数",
    foot: "请求",
    getValue: (summary) => summary.requestCount,
    format: (value) => formatInteger(value ?? 0),
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "inputTokens",
    label: "输入令牌",
    foot: "输入",
    getValue: (summary) => summary.inputTokens,
    format: (value) => formatCompactNumber(value ?? 0),
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "outputTokens",
    label: "输出令牌",
    foot: "输出",
    getValue: (summary) => summary.outputTokens,
    format: (value) => formatCompactNumber(value ?? 0),
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "totalTokens",
    label: "总令牌",
    foot: "总计",
    getValue: (summary) => summary.totalTokens,
    format: (value) => formatCompactNumber(value ?? 0),
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "activeTokenCount",
    label: "活跃密钥",
    foot: "密钥",
    getValue: (summary) => summary.activeTokenCount,
    format: (value) => formatInteger(value ?? 0),
    valueClassName: "text-[var(--foreground-muted)]",
  },
  {
    key: "activeUserCount",
    label: "活跃用户",
    foot: "用户",
    getValue: (summary) => summary.activeUserCount,
    format: (value) => formatInteger(value ?? 0),
    valueClassName: "text-[var(--foreground-muted)]",
  },
  {
    key: "activeChannelCount",
    label: "活跃渠道",
    foot: "渠道",
    getValue: (summary) => summary.activeChannelCount,
    format: (value) => formatInteger(value ?? 0),
    valueClassName: "text-[var(--foreground-muted)]",
  },
  {
    key: "avgFirstTokenLatency",
    label: "平均首 Token 耗时",
    foot: "s",
    getValue: (_, stabilitySummary) => stabilitySummary.avgFirstTokenLatency,
    format: formatDurationMsAsSeconds,
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "avgTotalResponseTime",
    label: "平均响应总耗时",
    foot: "s",
    getValue: (_, stabilitySummary) => stabilitySummary.avgTotalResponseTime,
    format: formatDurationSeconds,
    valueClassName: "text-[var(--foreground)]",
  },
  {
    key: "availabilityRate",
    label: "可用率",
    foot: "成功 / 总请求",
    getValue: (_, stabilitySummary) => getAvailabilityRate(stabilitySummary.errorRate),
    format: formatPercent,
    valueClassName: "text-[var(--foreground)]",
  },
];

function getAvailabilityRate(errorRate: number | null | undefined) {
  if (errorRate === null || errorRate === undefined || !Number.isFinite(errorRate)) {
    return null;
  }

  return Math.max(0, Math.min(1, 1 - errorRate));
}

export function SummaryCards({ summary, stabilitySummary }: SummaryCardsProps) {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="ds-kicker">概览</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => {
          const value = card.getValue(summary, stabilitySummary);

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
