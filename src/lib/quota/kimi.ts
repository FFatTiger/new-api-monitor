import type { AuthFile } from "../../types/auth.ts";
import type { KimiQuotaRow } from "../../types/quota.ts";

import { apiFetch } from "./api-client.ts";
import {
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  parseJsonMaybe,
} from "./upstream.ts";

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }

  return null;
}

function kimiResetTime(data: Record<string, unknown>): number | undefined {
  const absoluteKeys = ["reset_at", "resetAt", "reset_time", "resetTime"];
  for (const key of absoluteKeys) {
    const raw = data[key];
    if (typeof raw === "string" && raw.trim()) {
      try {
        const truncated = raw.replace(/(\.\d{6})\d+/, "$1");
        const date = new Date(truncated);
        if (Number.isNaN(date.getTime())) continue;
        if (date.getTime() <= Date.now()) return undefined;
        return date.getTime();
      } catch {
        continue;
      }
    }
  }

  const relativeKeys = ["reset_in", "resetIn", "ttl"];
  for (const key of relativeKeys) {
    const raw = toInt(data[key]);
    if (raw !== null && raw > 0) {
      return Date.now() + raw * 1000;
    }
  }

  return undefined;
}

function kimiLimitLabel(
  item: Record<string, unknown>,
  detail: Record<string, unknown>,
  window: Record<string, unknown>,
  index: number,
): string {
  for (const key of ["name", "title", "scope"] as const) {
    const value = item[key] ?? detail[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const duration = toInt(window.duration) ?? toInt(item.duration) ?? toInt(detail.duration);
  const timeUnit = window.timeUnit ?? item.timeUnit ?? detail.timeUnit;
  const unit = typeof timeUnit === "string" ? timeUnit.trim().toUpperCase() : "";

  if (duration !== null && duration > 0) {
    if (unit === "DAYS" || (unit === "HOURS" && duration >= 24)) {
      return "周窗口";
    }
    if (unit === "HOURS") {
      return `${duration}小时窗口`;
    }
    if (unit === "MINUTES") {
      const hours = Math.floor(duration / 60);
      if (hours > 0) {
        return `${hours}小时窗口`;
      }
    }
  }

  if (index === 0) return "5小时窗口";
  return `限额 #${index + 1}`;
}

function toKimiUsageRow(data: Record<string, unknown>, fallbackLabel: string): KimiQuotaRow | null {
  const limit = toInt(data.limit);
  let used = toInt(data.used);

  if (used === null) {
    const remaining = toInt(data.remaining);
    if (remaining !== null && limit !== null) {
      used = limit - remaining;
    }
  }

  if (used === null && limit === null) return null;

  const explicitLabel =
    (typeof data.name === "string" && data.name.trim()) || (typeof data.title === "string" && data.title.trim())
      ? ((data.name as string) || (data.title as string))
      : fallbackLabel;

  return {
    id: "",
    label: explicitLabel,
    used: used ?? 0,
    limit: limit ?? 0,
    resetTime: kimiResetTime(data),
  };
}

export function buildKimiQuotaRows(payload: Record<string, unknown>): KimiQuotaRow[] {
  const rows: KimiQuotaRow[] = [];
  const usage = payload.usage;

  if (usage && typeof usage === "object") {
    const summary = toKimiUsageRow(usage as Record<string, unknown>, "周窗口");
    if (summary) {
      rows.push({ ...summary, id: "summary" });
    }
  }

  const limits = payload.limits;
  if (Array.isArray(limits)) {
    limits.forEach((item, index) => {
      const detail = item && typeof item === "object" && item.detail && typeof item.detail === "object" ? item.detail : item;
      const window = item && typeof item === "object" && item.window && typeof item.window === "object" ? item.window : {};
      const fallbackLabel = kimiLimitLabel(
        item as Record<string, unknown>,
        detail as Record<string, unknown>,
        window as Record<string, unknown>,
        index,
      );
      const row = toKimiUsageRow(detail as Record<string, unknown>, fallbackLabel);
      if (row) {
        rows.push({ ...row, id: `limit-${index}` });
      }
    });
  }

  return rows;
}

export const fetchKimiQuota = async (file: AuthFile): Promise<{ rows: KimiQuotaRow[] }> => {
  const authIndex = file.authIndex;
  if (!authIndex) {
    throw new Error("Missing auth index for Kimi");
  }

  const apiResponse = await apiFetch("/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authIndex,
      provider: "kimi",
    }),
  });

  const json = normalizeApiCallEnvelope(await apiResponse.json());
  const statusCode = json.statusCode;

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`API Error ${getApiCallErrorMessage(json)}`);
  }

  const body = parseJsonMaybe(json.body ?? json.bodyText);

  const rows = buildKimiQuotaRows(body as Record<string, unknown>);
  if (rows.length === 0) {
    throw new Error("No quota data available");
  }

  return { rows };
};
