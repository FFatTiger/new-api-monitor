const integerFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
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

export function formatInteger(value: number) {
  return integerFormatter.format(value);
}

export function formatCompactNumber(value: number) {
  return compactFormatter.format(value);
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
