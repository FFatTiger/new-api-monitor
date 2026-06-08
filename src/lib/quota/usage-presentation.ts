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
