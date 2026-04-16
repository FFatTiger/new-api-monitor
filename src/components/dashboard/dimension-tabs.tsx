import { formatCompactNumber, formatDateTime, formatQuota, formatStatus } from "@/lib/format";
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
    <section className="grid gap-3 xl:grid-cols-3">
      <DimensionCard
        label="用户"
        title="用户排行"
        rows={users.map((row) => ({
          key: String(row.userId),
          primary: row.username,
          secondary: row.displayName || `状态 ${formatStatus(row.status)}`,
          metric: formatCompactNumber(row.totalTokens),
          meta: `请求 ${row.requestCount.toLocaleString("zh-CN")} · 配额 ${formatQuota(row.totalQuota)} · ${formatDateTime(row.latestUsedAt)}`,
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
          meta: `配额 ${formatQuota(row.totalQuota)} · ${formatDateTime(row.latestUsedAt)}`,
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
          meta: `请求 ${row.requestCount.toLocaleString("zh-CN")} · 余额 ${formatQuota(row.balance)} · ${formatDateTime(row.latestUsedAt)}`,
        }))}
      />
    </section>
  );
}

interface DimensionCardRow {
  key: string;
  primary: string;
  secondary: string;
  metric: string;
  meta: string;
}

interface DimensionCardProps {
  label: string;
  title: string;
  rows: DimensionCardRow[];
}

function DimensionCard({ label, title, rows }: DimensionCardProps) {
  return (
    <article className="rounded-[1.2rem] border border-[#273140] bg-[linear-gradient(180deg,rgba(6,10,15,0.98),rgba(8,13,20,0.98))] p-2.5 shadow-[0_24px_90px_rgba(0,0,0,0.28)] sm:rounded-[1.45rem] sm:p-3">
      <div className="mb-3 border-b border-white/6 pb-3">
        <p className="text-[0.56rem] uppercase tracking-[0.2em] text-slate-500 sm:text-[0.6rem] sm:tracking-[0.28em]">{label}</p>
        <h2 className="mt-1 [font-family:var(--font-code)] text-[0.86rem] font-semibold uppercase tracking-[0.16em] text-white sm:text-[0.96rem] sm:tracking-[0.2em]">
          {title}
        </h2>
      </div>

      <div className="space-y-2.5">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="rounded-[0.9rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-3 py-3 sm:rounded-[1rem]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="[font-family:var(--font-code)] text-[0.58rem] uppercase tracking-[0.16em] text-slate-600 sm:text-[0.62rem] sm:tracking-[0.2em]">
                  #{String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 break-words text-sm font-semibold text-white">{row.primary}</h3>
                <p className="mt-1 break-words text-[0.68rem] uppercase tracking-[0.08em] text-slate-500 sm:text-[0.72rem] sm:tracking-[0.12em]">
                  {row.secondary}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[0.54rem] uppercase tracking-[0.16em] text-slate-600 sm:text-[0.58rem] sm:tracking-[0.22em]">令牌</p>
                <p className="mt-2 [font-family:var(--font-code)] text-[0.84rem] font-semibold text-cyan-300 sm:text-[0.92rem]">
                  {row.metric}
                </p>
              </div>
            </div>
            <p className="mt-3 break-words text-[0.66rem] uppercase tracking-[0.06em] text-slate-500 sm:text-[0.68rem] sm:tracking-[0.1em]">{row.meta}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
