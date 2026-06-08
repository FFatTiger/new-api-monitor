import type { ProviderType, QuotaData, RateLimitWindow } from "@/types/quota";

export type ProviderQuotaSnapshotInput = {
  provider: ProviderType;
  remainingPercent: number;
  usedPercent: number;
  resetTime: string | number | null;
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return clampPercent(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampPercent(parsed) : null;
  }
  return null;
}

function getRemainingPercent(windowData: RateLimitWindow) {
  const explicit = normalizePercent(windowData.remainingPercent ?? windowData.remaining_percent);
  if (explicit !== null) return explicit;

  const used = normalizePercent(windowData.usedPercent ?? windowData.used_percent);
  return used === null ? null : clampPercent(100 - used);
}

function isWeeklyWindow(windowData: RateLimitWindow) {
  const id = String(windowData.id || "").toLowerCase();
  const label = String(windowData.label || "").toLowerCase();
  return id.includes("weekly") || id.includes("week") || label.includes("周") || label.includes("week");
}

function pickWindow(provider: ProviderType, windows: RateLimitWindow[]) {
  if (!windows.length) return null;

  if (provider === "codex" || provider === "claude") {
    return windows.find(isWeeklyWindow) || windows[1] || windows[0];
  }

  if (provider === "zai") {
    return windows.find((windowData) => String(windowData.id || "").toLowerCase() === "tokens-limit") || windows.find(isWeeklyWindow) || windows[0];
  }

  if (provider === "minimax") {
    return windows.find(isWeeklyWindow) || windows[0];
  }

  return windows.find(isWeeklyWindow) || windows[0];
}

export function getQuotaWindowSnapshot(provider: ProviderType, data: QuotaData): Omit<ProviderQuotaSnapshotInput, "provider"> | null {
  const windowData = pickWindow(provider, data.windows || []);
  if (!windowData) return null;

  const remainingPercent = getRemainingPercent(windowData);
  if (remainingPercent === null) return null;

  const explicitUsed = normalizePercent(windowData.usedPercent ?? windowData.used_percent);
  const usedPercent = explicitUsed === null ? clampPercent(100 - remainingPercent) : explicitUsed;
  const resetTime = windowData.resetTime ?? windowData.reset_time ?? windowData.reset_at ?? windowData.resetAt ?? null;

  return { remainingPercent, usedPercent, resetTime };
}

export function aggregateProviderQuotaSnapshot(provider: ProviderType, dataItems: QuotaData[]): ProviderQuotaSnapshotInput | null {
  const snapshots = dataItems
    .map((data) => getQuotaWindowSnapshot(provider, data))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));

  if (!snapshots.length) return null;

  const limiting = snapshots.reduce((selected, candidate) =>
    candidate.remainingPercent < selected.remainingPercent ? candidate : selected,
  );

  return { provider, ...limiting };
}
