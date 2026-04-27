import type { ReactNode } from "react";

import { formatCompactNumber, formatDateTime, formatStatus } from "@/lib/format";
import type {
  ChannelRankingRow,
  ModelRankingRow,
  UserRankingRow,
} from "@/lib/queries/dashboard";

interface DimensionTabsProps {
  users: UserRankingRow[];
  models: ModelRankingRow[];
  channels: ChannelRankingRow[];
}

export function DimensionTabs({ users, models, channels }: DimensionTabsProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <DimensionCard
        label="用户"
        title="用户排行"
        rows={users.map((row) => ({
          key: String(row.userId),
          primary: row.username,
          secondary: row.displayName || `状态 ${formatStatus(row.status)}`,
          metric: formatCompactNumber(row.totalTokens),
          meta: `请求 ${row.requestCount.toLocaleString("zh-CN")} · ${formatDateTime(row.latestUsedAt)}`,
        }))}
      />
      <DimensionCard
        label="模型"
        title="模型排行"
        rows={models.map((row) => ({
          key: row.modelName,
          primary: row.modelName,
          secondary: `${row.requestCount.toLocaleString("zh-CN")} 次请求`,
          metric: formatCompactNumber(row.totalTokens),
          meta: `${formatDateTime(row.latestUsedAt)}`,
        }))}
      />
      <DimensionCard
        label="渠道"
        title="渠道排行"
        rows={channels.map((row) => ({
          key: String(row.channelId),
          primary: row.channelName,
          secondary: `编号 ${row.channelId} · ${formatStatus(row.status)}`,
          metric: formatCompactNumber(row.totalTokens),
          meta: `请求 ${row.requestCount.toLocaleString("zh-CN")} · ${formatDateTime(row.latestUsedAt)}`,
        }))}
      />
    </section>
  );
}

interface DimensionCardRow {
  key: string;
  primary: string;
  secondary: string;
  metric: ReactNode;
  meta: string;
}

interface DimensionCardProps {
  label: string;
  title: string;
  rows: DimensionCardRow[];
}

function DimensionCard({ label, title, rows }: DimensionCardProps) {
  return (
    <article className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 pb-4">
        <p className="ds-kicker">{label}</p>
        <h2 className="mt-3 text-[1.08rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)]">{title}</h2>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.key} className="ds-card-muted ds-card-interactive px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</p>
                <h3 className="mt-2 break-words text-[0.92rem] font-semibold text-[var(--foreground)]">{row.primary}</h3>
                <p className="mt-1 break-words text-[0.74rem] text-[var(--foreground-soft)]">{row.secondary}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="ds-kicker text-[0.56rem] text-[var(--foreground-faint)]">令牌</p>
                <p className="mt-1.5 ds-mono text-[0.9rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">{row.metric}</p>
              </div>
            </div>
            <p className="mt-3 break-words text-[0.72rem] text-[var(--foreground-soft)]">{row.meta}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
