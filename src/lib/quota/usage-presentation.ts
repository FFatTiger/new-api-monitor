export function formatPredictionDurationMinutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  if (value <= 0) return value === 0 ? "0M" : "--";
  if (value < 1) return "<1M";

  const totalMinutes = Math.round(value);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}D${hours > 0 ? ` ${hours}H` : ""}`;
  if (hours > 0) return `${hours}H${minutes > 0 ? ` ${minutes}M` : ""}`;
  return `${minutes}M`;
}

export function formatPredictionExhaustionLabel(status: string, minutesLeft: number | null) {
  if (status === "unconfigured") return "未配置";
  if (status === "no_snapshot") return "等待采样";
  if (status === "calibrating") return "等待校准";
  if (status === "no_recent_usage") return "暂无趋势";
  if (status === "exhausted") return "已耗尽";
  if (status === "safe_until_reset") return "重置前安全";
  return `预计 ${formatPredictionDurationMinutes(minutesLeft)} 耗尽`;
}
