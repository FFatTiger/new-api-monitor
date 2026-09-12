import type { BucketData, KimiQuotaRow, ModelData, ProviderType, QuotaData, RateLimitWindow } from "@/types/quota";

import { normalizeFraction } from "@/lib/quota/normalize";
import { getProgressTone, ProgressBar } from "@/components/quota/progress-bar";

const antigravityGroups = [
  { id: "claude", label: "Claude", patterns: ["claude", "gpt-oss"] },
  { id: "gemini-3", label: "Gemini", patterns: ["gemini-3", "gemini-2.5"] },
];

const aggregateAntigravityModels = (models: Record<string, ModelData>) => {
  return antigravityGroups
    .map((group) => {
      let minFraction = Infinity;
      let selectedResetTime: string | number | undefined;
      let hasMatch = false;

      for (const [modelId, model] of Object.entries(models)) {
        if (!group.patterns.some((pattern) => modelId.toLowerCase().includes(pattern.toLowerCase()))) {
          continue;
        }

        hasMatch = true;
        const info = model.quotaInfo || model.quota_info || {};
        const fraction = normalizeFraction(info.remaining_fraction ?? info.remainingFraction ?? info.remaining);
        const resetTime = info.resetTime || info.reset_time;

        if (fraction < minFraction) {
          minFraction = fraction;
          selectedResetTime = resetTime;
        }
      }

      if (!hasMatch) return null;
      return {
        id: group.id,
        label: group.label,
        fraction: minFraction === Infinity ? 1 : minFraction,
        resetTime: selectedResetTime,
      };
    })
    .filter(Boolean) as Array<{ id: string; label: string; fraction: number; resetTime?: string | number }>;
};

function renderCodexWindow(windowData: RateLimitWindow | undefined, label: string) {
  if (!windowData) return null;

  const remaining =
    windowData.remainingPercent ??
    windowData.remaining_percent ??
    (windowData.used_percent === undefined && windowData.usedPercent === undefined
      ? null
      : Math.max(0, 100 - (windowData.used_percent ?? windowData.usedPercent ?? 0)));
  const resetAt = windowData.resetTime ?? windowData.reset_time ?? windowData.reset_at ?? windowData.resetAt;

  return (
    <ProgressBar
      key={windowData.id || label}
      label={windowData.label || label}
      percent={remaining ?? 0}
      valueLabel={windowData.valueLabel || (remaining === null ? "--" : `${Math.round(remaining)}%`)}
      resetTime={resetAt}
      colorClass={remaining === null ? "bg-[var(--foreground-faint)]/40" : getProgressTone(remaining / 100)}
    />
  );
}

export function QuotaContent({ type, data }: { type: ProviderType; data: QuotaData }) {
  if (!data) return null;

  if (type === "antigravity") {
    const upstreamGroups = data.groups || [];
    if (upstreamGroups.length) {
      return (
        <div className="space-y-2.5">
          {upstreamGroups.map((group) => (
            <ProgressBar
              key={group.id}
              label={group.label}
              percent={group.remainingFraction * 100}
              valueLabel={`${Math.round(group.remainingFraction * 100)}%`}
              resetTime={group.resetTime}
              colorClass={getProgressTone(group.remainingFraction)}
            />
          ))}
        </div>
      );
    }

    const groups = aggregateAntigravityModels(data.models || {});
    if (!groups.length) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无配额信息</div>;
    }

    return (
      <div className="space-y-2.5">
        {groups.map((group) => (
          <ProgressBar
            key={group.id}
            label={group.label}
            percent={group.fraction * 100}
            valueLabel={`${Math.round(group.fraction * 100)}%`}
            resetTime={group.resetTime}
            colorClass={getProgressTone(group.fraction)}
          />
        ))}
      </div>
    );
  }

  if (type === "codex") {
    const windows = data.windows || [];
    if (windows.length) {
      return <div className="space-y-2.5">{windows.map((window) => renderCodexWindow(window, window.label || window.id || "窗口"))}</div>;
    }

    const rateLimit = data.rate_limit || data.rateLimit;
    if (!rateLimit) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无数据</div>;
    }

    return (
      <div className="space-y-2.5">
        {renderCodexWindow(rateLimit.primary_window || rateLimit.primaryWindow, "5小时窗口")}
        {renderCodexWindow(rateLimit.secondary_window || rateLimit.secondaryWindow, "周窗口")}
      </div>
    );
  }

  if (type === "gemini-cli") {
    const buckets = data.buckets || [];
    if (!buckets.length) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无配额桶</div>;
    }

    return (
      <div className="space-y-2.5">
        {data.tierLabel || data.tierId ? (
          <div className="flex items-center justify-between text-[0.72rem]">
            <span className="text-[var(--foreground-soft)]">Tier</span>
            <span className="ds-mono text-[var(--foreground)]">{String(data.tierLabel || data.tierId)}</span>
          </div>
        ) : null}
        {typeof data.creditBalance === "number" ? (
          <div className="flex items-center justify-between text-[0.72rem]">
            <span className="text-[var(--foreground-soft)]">Credits</span>
            <span className="ds-mono text-[var(--foreground)]">{data.creditBalance}</span>
          </div>
        ) : null}
        {buckets.map((bucket: BucketData, index: number) => {
          const modelId = bucket.model_id || bucket.modelId || `bucket-${index}`;
          const fraction = normalizeFraction(bucket.remaining_fraction ?? bucket.remainingFraction);
          const resetTime = bucket.reset_time || bucket.resetTime;

          return (
            <ProgressBar
              key={`${modelId}-${index}`}
              label={bucket.label || modelId}
              percent={fraction * 100}
              valueLabel={`${Math.round(fraction * 100)}%`}
              resetTime={resetTime}
              colorClass={getProgressTone(fraction, "blue")}
            />
          );
        })}
      </div>
    );
  }

  if (type === "claude") {
    const windows = data.windows || [];
    if (!windows.length) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无数据</div>;
    }

    return <div className="space-y-2.5">{windows.map((window) => renderCodexWindow(window, window.label || window.id || "窗口"))}</div>;
  }

  if (type === "kimi") {
    const rows = (data.rows || []).slice().reverse();
    if (!rows.length) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无额度数据</div>;
    }

    return (
      <div className="space-y-2.5">
        {rows.map((row: KimiQuotaRow) => {
          const remaining = row.limit > 0 ? Math.max(0, Math.min(100, Math.round(((row.limit - row.used) / row.limit) * 100))) : row.used > 0 ? 0 : null;
          return (
            <ProgressBar
              key={row.id}
              label={row.label}
              percent={remaining ?? 0}
              valueLabel={remaining === null ? "--" : `${remaining}%`}
              resetTime={row.resetTime}
              colorClass={remaining === null ? "bg-[var(--foreground-faint)]/40" : getProgressTone(remaining / 100)}
            />
          );
        })}
      </div>
    );
  }

  if (type === "minimax") {
    const windows = data.windows || [];
    if (!windows.length) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无额度数据</div>;
    }

    return <div className="space-y-2.5">{windows.map((window) => renderCodexWindow(window, window.label || window.id || "额度"))}</div>;
  }

  if (type === "xai" || type === "zai") {
    const windows = data.windows || [];
    if (!windows.length) {
      return <div className="text-[0.78rem] text-[var(--foreground-faint)]">暂无额度数据</div>;
    }

    return <div className="space-y-2.5">{windows.map((window) => renderCodexWindow(window, window.label || window.id || "额度"))}</div>;
  }

  return <div className="text-[0.78rem] text-[var(--foreground-faint)]">未知数据格式</div>;
}
