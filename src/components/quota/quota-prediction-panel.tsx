"use client";

import { ProviderIcon } from "@/components/quota/provider-icon";
import { formatCompactNumberStr, formatDateTime } from "@/lib/format";
import { QUOTA_USAGE_WINDOW_OPTIONS } from "@/lib/quota/usage-config";
import type { ProviderFilter, ProviderType, QuotaUsagePredictionRow } from "@/types/quota";

const providerLabels: Record<Exclude<ProviderType, "unknown">, string> = {
  antigravity: "Antigravity",
  claude: "Claude",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  kimi: "Kimi",
  minimax: "MiniMax",
  xai: "Grok",
  zai: "Z.ai",
};

function getProviderLabel(provider: ProviderType) {
  if (provider === "unknown") return "未知";
  return providerLabels[provider] || provider;
}

function formatDurationMinutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  if (value <= 0) return "已耗尽";

  const totalMinutes = Math.round(value);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}天${hours > 0 ? `${hours}小时` : ""}`;
  if (hours > 0) return `${hours}小时${minutes > 0 ? `${minutes}分钟` : ""}`;
  return `${minutes}分钟`;
}

function getStatusText(row: QuotaUsagePredictionRow) {
  if (row.status === "unconfigured") return "未配置渠道映射";
  if (row.status === "no_snapshot") return "等待 quota 快照";
  if (row.status === "no_recent_usage") return "近窗口暂无消耗";
  if (row.status === "exhausted") return "已耗尽或剩余为 0";
  return `预计 ${formatDurationMinutes(row.minutesLeft)} 后耗尽 · ${row.exhaustAt ? formatDateTime(row.exhaustAt) : "--"}`;
}

function PredictionRow({ row, windowLabel }: { row: QuotaUsagePredictionRow; windowLabel: string }) {
  const ready = row.status === "ready";

  return (
    <div className="grid gap-3 rounded-[16px] bg-[var(--background-elevated)] px-3 py-3 shadow-[0_0_0_1px_var(--surface-ring-soft)] md:grid-cols-[minmax(120px,0.9fr)_minmax(0,3fr)] md:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <div className="rounded-[10px] bg-[var(--background-subtle)] p-1.5 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
          <ProviderIcon type={row.provider} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[0.82rem] font-semibold text-[var(--foreground)]">{getProviderLabel(row.provider)}</div>
          <div className="mt-0.5 text-[0.66rem] text-[var(--foreground-faint)]">渠道 {row.channelIds.length ? row.channelIds.join(", ") : "--"}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.74rem] text-[var(--foreground-soft)]">
        <span>
          今日 GPT <span className="ds-mono text-[var(--foreground)]">{formatCompactNumberStr(row.todayGptTokens)}</span>
        </span>
        <span>
          今日 quota <span className="ds-mono text-[var(--foreground)]">{formatCompactNumberStr(row.todayQuota)}</span>
        </span>
        <span>
          近{windowLabel} <span className="ds-mono text-[var(--foreground)]">{row.recentQuotaPerHour === null ? "--" : `${formatCompactNumberStr(row.recentQuotaPerHour)}/h`}</span>
        </span>
        <span className={ready ? "text-emerald-500" : "text-[var(--foreground-faint)]"}>{getStatusText(row)}</span>
      </div>
    </div>
  );
}

export function QuotaPredictionPanel({
  predictions,
  selectedProvider,
  windowMinutes,
  loading,
  error,
  onWindowMinutesChange,
}: {
  predictions: QuotaUsagePredictionRow[];
  selectedProvider: ProviderFilter;
  windowMinutes: number;
  loading: boolean;
  error: string | null;
  onWindowMinutesChange: (value: number) => void;
}) {
  const windowLabel = QUOTA_USAGE_WINDOW_OPTIONS.find((option) => option.minutes === windowMinutes)?.label || "12 小时";
  const rows = selectedProvider === "all" ? predictions : predictions.filter((row) => row.provider === selectedProvider);

  return (
    <section className="ds-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[0.95rem] font-semibold text-[var(--foreground)]">额度预测</h2>
          <p className="mt-1 text-[0.74rem] text-[var(--foreground-soft)]">按 compose 配置的 provider 渠道组汇总。</p>
        </div>
        <div className="flex items-center gap-2 text-[0.74rem] text-[var(--foreground-soft)]">
          <span>速度窗口</span>
          <select
            value={windowMinutes}
            onChange={(event) => onWindowMinutesChange(Number(event.target.value))}
            className="ds-compact-control h-9 min-w-[112px] appearance-none pr-8"
            aria-label="额度预测速度窗口"
          >
            {QUOTA_USAGE_WINDOW_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <div className="rounded-[14px] bg-red-500/10 px-3 py-2 text-[0.76rem] text-red-500">{error}</div> : null}

      {!error && rows.length === 0 ? (
        <div className="rounded-[14px] bg-[var(--background-elevated)] px-3 py-3 text-[0.76rem] text-[var(--foreground-faint)] shadow-[0_0_0_1px_var(--surface-ring-soft)]">
          {selectedProvider === "all" ? "配置 QUOTA_USAGE_GROUPS 后展示预测" : "当前 provider 未配置渠道映射"}
        </div>
      ) : null}

      {!error && rows.length > 0 ? (
        <div className={loading ? "space-y-2 opacity-70" : "space-y-2"}>
          {rows.map((row) => (
            <PredictionRow key={row.provider} row={row} windowLabel={windowLabel} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
