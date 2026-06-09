"use client";

import { ProviderIcon } from "@/components/quota/provider-icon";
import { QUOTA_USAGE_WINDOW_OPTIONS } from "@/lib/quota/usage-config";
import { formatPredictionExhaustionLabel } from "@/lib/quota/usage-presentation";
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

function getEtaLabel(row: QuotaUsagePredictionRow) {
  return formatPredictionExhaustionLabel(row.status, row.minutesLeft);
}

function PredictionChip({ row }: { row: QuotaUsagePredictionRow }) {
  const positive = row.status === "ready" || row.status === "safe_until_reset";

  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-full bg-[var(--background-elevated)] px-2.5 py-1.5 text-[0.72rem] shadow-[0_0_0_1px_var(--surface-ring-soft)]"
      title={`${getProviderLabel(row.provider)} · ${getEtaLabel(row)}`}
    >
      <div className="shrink-0">
        <ProviderIcon type={row.provider} />
      </div>
      <span className="font-medium text-[var(--foreground)]">{getProviderLabel(row.provider)}</span>
      <span className={["ds-mono", positive ? "text-emerald-500" : "text-[var(--foreground-faint)]"].join(" ")}>{getEtaLabel(row)}</span>
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
  const rows = selectedProvider === "all" ? predictions : predictions.filter((row) => row.provider === selectedProvider);

  return (
    <section className="ds-panel px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 shrink-0 text-[0.78rem] font-semibold text-[var(--foreground)]">额度预测</h2>
        <div className="shrink-0">
          <select
            value={windowMinutes}
            onChange={(event) => onWindowMinutesChange(Number(event.target.value))}
            className="ds-compact-control h-8 min-w-[98px] appearance-none pr-8 text-[0.72rem]"
            aria-label="额度预测速度窗口"
          >
            {QUOTA_USAGE_WINDOW_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error ? <span className="rounded-full bg-red-500/10 px-2.5 py-1.5 text-[0.72rem] text-red-500">{error}</span> : null}
        {!error && rows.length === 0 ? (
          <span className="rounded-full bg-[var(--background-elevated)] px-2.5 py-1.5 text-[0.72rem] text-[var(--foreground-faint)] shadow-[0_0_0_1px_var(--surface-ring-soft)]">
            {selectedProvider === "all" ? "配置 QUOTA_USAGE_GROUPS 后展示预测" : "当前 provider 未配置渠道映射"}
          </span>
        ) : null}
        {!error && rows.length > 0 ? (
          <div className={["flex flex-wrap items-center gap-2", loading ? "opacity-70" : ""].filter(Boolean).join(" ")}>
            {rows.map((row) => (
              <PredictionChip key={row.provider} row={row} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
