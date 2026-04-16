import { DashboardFiltersBar } from "@/components/dashboard/filters";
import { formatCompactNumber, formatInteger, formatQuota } from "@/lib/format";
import type { FilterOption, SummaryMetrics, DashboardFilters } from "@/lib/queries/dashboard";

interface SummaryCardsProps {
  summary: SummaryMetrics;
  windowLabel: string;
  filters: DashboardFilters;
  usernameOptions: FilterOption[];
  modelOptions: FilterOption[];
  channelOptions: FilterOption[];
}

const cards = [
  {
    key: "requestCount",
    label: "请求数",
    foot: "请求",
    tone: "text-cyan-300",
    format: formatInteger,
  },
  {
    key: "totalTokens",
    label: "令牌消耗",
    foot: "令牌",
    tone: "text-slate-100",
    format: formatCompactNumber,
  },
  {
    key: "totalQuota",
    label: "配额消耗",
    foot: "配额",
    tone: "text-amber-300",
    format: formatQuota,
  },
  {
    key: "activeTokenCount",
    label: "活跃密钥",
    foot: "密钥",
    tone: "text-emerald-300",
    format: formatInteger,
  },
  {
    key: "activeUserCount",
    label: "活跃用户",
    foot: "用户",
    tone: "text-sky-300",
    format: formatInteger,
  },
  {
    key: "activeChannelCount",
    label: "活跃渠道",
    foot: "渠道",
    tone: "text-orange-300",
    format: formatInteger,
  },
] as const;

export function SummaryCards({
  summary,
  windowLabel,
  filters,
  usernameOptions,
  modelOptions,
  channelOptions,
}: SummaryCardsProps) {
  return (
    <section className="rounded-[1.25rem] border border-[#273140] bg-[linear-gradient(180deg,rgba(7,11,16,0.96),rgba(10,15,22,0.98))] p-2.5 shadow-[0_24px_90px_rgba(0,0,0,0.35)] sm:rounded-[1.55rem] sm:p-3">
      <div className="mb-3 space-y-3 border-b border-white/6 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-[0.85rem] border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.62rem] uppercase tracking-[0.18em] text-slate-400 sm:rounded-[0.9rem] sm:text-[0.64rem] sm:tracking-[0.22em]">
            {windowLabel}
          </span>
        </div>

        <DashboardFiltersBar
          filters={filters}
          usernameOptions={usernameOptions}
          modelOptions={modelOptions}
          channelOptions={channelOptions}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => {
          const value = summary[card.key];

          return (
            <article
              key={card.key}
              className="rounded-[0.95rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-3 py-3 sm:rounded-[1rem] sm:px-4"
            >
              <p className="text-[0.56rem] uppercase tracking-[0.18em] text-slate-500 sm:text-[0.6rem] sm:tracking-[0.24em]">
                {card.label}
              </p>
              <div className="mt-2.5 flex items-end justify-between gap-2 sm:mt-3 sm:gap-3">
                <p
                  className={`[font-family:var(--font-code)] text-[1.1rem] font-semibold leading-none tracking-[-0.04em] sm:text-[1.55rem] sm:tracking-[-0.05em] ${card.tone}`}
                >
                  {card.format(value)}
                </p>
                <span className="text-[0.56rem] uppercase tracking-[0.16em] text-slate-600 sm:text-[0.62rem] sm:tracking-[0.22em]">
                  {card.foot}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
