import type { ProviderType, QuotaData, RateLimitWindow } from "@/types/quota";

export type WeeklyQuotaRingData = {
  percent: number | null;
  label: "周额度";
  valueLabel: string;
  tone: "emerald" | "amber" | "red" | "muted";
};

const emptyWeeklyRing: WeeklyQuotaRingData = {
  percent: null,
  label: "周额度",
  valueLabel: "--",
  tone: "muted",
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRemainingPercent(windowData?: RateLimitWindow | null) {
  if (!windowData) return null;

  const remaining = windowData.remainingPercent ?? windowData.remaining_percent;
  if (typeof remaining === "number" && Number.isFinite(remaining)) {
    return clampPercent(remaining);
  }

  const used = windowData.usedPercent ?? windowData.used_percent;
  if (typeof used === "number" && Number.isFinite(used)) {
    return clampPercent(100 - used);
  }

  return null;
}

function getTone(percent: number): WeeklyQuotaRingData["tone"] {
  if (percent < 20) return "red";
  if (percent < 50) return "amber";
  return "emerald";
}

function findWeeklyWindow(windows: RateLimitWindow[]) {
  return windows.find((windowData) => {
    const id = String(windowData.id || "").toLowerCase();
    const label = String(windowData.label || "").toLowerCase();
    return id.includes("weekly") || id.includes("week") || label.includes("周") || label.includes("week");
  });
}

export function getWeeklyQuotaRingData(type: ProviderType, data?: QuotaData): WeeklyQuotaRingData {
  if (!data || (type !== "codex" && type !== "claude")) return emptyWeeklyRing;

  const weeklyWindow = data.windows?.length
    ? findWeeklyWindow(data.windows)
    : data.rateLimit?.secondaryWindow ?? data.rate_limit?.secondary_window;
  const percent = getRemainingPercent(weeklyWindow);

  if (percent === null) return emptyWeeklyRing;

  return {
    percent,
    label: "周额度",
    valueLabel: `${percent}%`,
    tone: getTone(percent),
  };
}
