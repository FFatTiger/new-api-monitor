import { formatDateTime } from "@/lib/format";

function getCountdown(value?: string | number) {
  if (!value) return null;

  const timestamp =
    typeof value === "number" ? (value > 1_000_000_000_000 ? value : value * 1000) : new Date(value).getTime();
  const diffMs = timestamp - Date.now();
  if (!Number.isFinite(timestamp) || diffMs <= 0) return null;

  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = diffMs / 3_600_000;
  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = Math.floor(diffHours % 24);

  if (diffDays >= 1) {
    return remainingHours > 0 ? `${diffDays}d${remainingHours}h` : `${diffDays}d`;
  }
  if (diffHours >= 1) {
    return `${diffHours.toFixed(1)}h`;
  }
  return `${diffMinutes}m`;
}

export function getProgressTone(fraction: number, variant: "default" | "blue" = "default") {
  if (fraction < 0.2) return "bg-red-400/80";
  if (fraction < 0.5) return "bg-amber-400/80";
  return variant === "blue" ? "bg-blue-400/80" : "bg-emerald-400/80";
}

type ProgressBarProps = {
  percent: number;
  colorClass?: string;
  label?: string;
  valueLabel?: string;
  resetTime?: string | number;
};

export function ProgressBar({ percent, colorClass = "bg-blue-400/80", label, valueLabel, resetTime }: ProgressBarProps) {
  const countdown = getCountdown(resetTime);
  const tooltip =
    typeof resetTime === "number"
      ? formatDateTime(resetTime > 1_000_000_000_000 ? Math.floor(resetTime / 1000) : resetTime)
      : resetTime
        ? formatDateTime(Math.floor(new Date(resetTime).getTime() / 1000))
        : undefined;

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,5.75rem)_4.25rem] items-center gap-1.5">
        <span className="min-w-0 truncate text-[0.72rem] text-[var(--foreground-soft)]">{label}</span>
        <span className="ds-mono text-right text-[0.72rem] font-medium text-[var(--foreground)]">{valueLabel || `${Math.round(percent)}%`}</span>
        <div className="min-w-0 text-right text-[0.72rem]">
          {countdown ? (
            <span className="ds-mono whitespace-nowrap text-[var(--foreground-faint)]" title={tooltip}>
              · {countdown}
            </span>
          ) : null}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--background-subtle)] shadow-[inset_0_0_0_1px_var(--surface-ring-soft)]">
        <div className={`h-full rounded-full transition-all duration-500 ease-out ${colorClass}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}
