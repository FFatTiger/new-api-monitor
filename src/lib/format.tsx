import type { ReactElement } from "react";

import { formatOutputTokensPerSec, getCacheRatio } from "./format-metrics";

export { formatOutputTokensPerSec, getCacheRatio };

const integerFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const durationFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});

const shortDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

const fullFormatter = new Intl.NumberFormat("zh-CN");

export function formatInteger(value: number) {
  return <span title={fullFormatter.format(value)}>{integerFormatter.format(value)}</span>;
}

export function formatCompactNumber(value: number) {
  return <span title={fullFormatter.format(value)}>{compactFormatter.format(value)}</span>;
}

export function formatCompactNumberStr(value: number) {
  return compactFormatter.format(value);
}

export function formatInputWithCache(inputTokens: number, cacheTokens: number): string | ReactElement {
  if (cacheTokens > 0) {
    const cacheRatio = getCacheRatio(inputTokens, cacheTokens);

    return (
      <span title={`${fullFormatter.format(inputTokens)} (Cache ${fullFormatter.format(cacheTokens)}, ${percentFormatter.format(cacheRatio)})`}>
        {formatCompactNumber(inputTokens)}
        <span className="block text-[0.62em] text-[var(--foreground-muted)]">
          Cache {percentFormatter.format(cacheRatio)}
        </span>
      </span>
    );
  }
  return formatCompactNumber(inputTokens);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return percentFormatter.format(value);
}

export function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return "-";
  }

  return `${durationFormatter.format(value)} ms`;
}

export function formatDurationMsAsSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return "-";
  }

  return `${durationFormatter.format(value / 1000)} s`;
}

export function formatDurationSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return "-";
  }

  return `${durationFormatter.format(value)} s`;
}

export function formatDateTime(timestamp: number) {
  if (!timestamp || timestamp < 0) {
    return "-";
  }

  return dateTimeFormatter.format(new Date(timestamp * 1000));
}

export function formatTrendLabel(timestamp: number, granularity: "hour" | "day") {
  const date = new Date(timestamp * 1000);
  return granularity === "hour"
    ? shortDateTimeFormatter.format(date)
    : shortDateFormatter.format(date);
}

export function formatStatus(status: number) {
  switch (status) {
    case 1:
      return "启用";
    case 2:
      return "禁用";
    case 3:
      return "异常";
    case -1:
      return "未知";
    default:
      return `状态 ${status}`;
  }
}
