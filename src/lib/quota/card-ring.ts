import type { ProviderType, QuotaData, RateLimitWindow } from "@/types/quota";

export type WeeklyQuotaRingData = {
  percent: number | null;
  label: string;
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

function findMiniMaxWindow(windows: RateLimitWindow[]) {
  return (
    findWeeklyWindow(windows) ||
    windows.find((windowData) => {
      const id = String(windowData.id || "").toLowerCase();
      const label = String(windowData.label || "").toLowerCase();
      return id.includes("hour") || label.includes("小时") || label.includes("hour");
    }) ||
    windows[0]
  );
}

function findZaiWindow(windows: RateLimitWindow[]) {
  return (
    findWeeklyWindow(windows) ||
    windows[0]
  );
}

function getRingWindow(type: ProviderType, data: QuotaData) {
  if (type === "codex" || type === "claude") {
    return data.windows?.length
      ? findWeeklyWindow(data.windows)
      : data.rateLimit?.secondaryWindow ?? data.rate_limit?.secondary_window;
  }

  if (type === "minimax") return findMiniMaxWindow(data.windows || []);
  if (type === "zai") return findZaiWindow(data.windows || []);

  return null;
}

export function getWeeklyQuotaRingData(type: ProviderType, data?: QuotaData): WeeklyQuotaRingData {
  if (!data || !["codex", "claude", "minimax", "zai"].includes(type)) return emptyWeeklyRing;

  const ringWindow = getRingWindow(type, data);
  const percent = getRemainingPercent(ringWindow);

  if (percent === null) return emptyWeeklyRing;

  return {
    percent,
    label: type === "codex" || type === "claude" ? "周额度" : ringWindow?.label || "总额度",
    valueLabel: `${percent}%`,
    tone: getTone(percent),
  };
}
