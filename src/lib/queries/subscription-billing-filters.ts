export type SubscriptionBillingPreset =
  | "this_month"
  | "last_month"
  | "today"
  | "7d"
  | "30d"
  | "all"
  | "custom";

export type SubscriptionBillingSearchParams = Record<
  string,
  string | string[] | undefined
>;

export interface SubscriptionBillingFilters {
  preset: SubscriptionBillingPreset;
  startInput: string;
  endInput: string;
  startTimestamp: number | null;
  endTimestamp: number | null;
  windowLabel: string;
  validationMessage: string | null;
}

const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

function getFirstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function shanghaiTimestamp(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - SHANGHAI_OFFSET_SECONDS;
}

function getShanghaiParts(timestamp: number) {
  const shifted = new Date((timestamp + SHANGHAI_OFFSET_SECONDS) * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function formatSubscriptionDateTimeInput(timestamp: number): string {
  const { year, month, day, hour, minute } = getShanghaiParts(timestamp);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseShanghaiDateTimeInput(value: string, endOfMinute: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? (endOfMinute ? 59 : 0) : Number(secondText);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  const timestamp = shanghaiTimestamp(year, month, day, hour, minute, second);
  const parsed = getShanghaiParts(timestamp);
  if (
    parsed.year !== year ||
    parsed.month !== month ||
    parsed.day !== day ||
    parsed.hour !== hour ||
    parsed.minute !== minute ||
    parsed.second !== second
  ) {
    return null;
  }

  return timestamp;
}

function parsePreset(value: string): SubscriptionBillingPreset | null {
  if (
    value === "this_month" ||
    value === "last_month" ||
    value === "today" ||
    value === "7d" ||
    value === "30d" ||
    value === "all" ||
    value === "custom"
  ) {
    return value;
  }
  return null;
}

function boundedFilters(
  preset: Exclude<SubscriptionBillingPreset, "all" | "custom">,
  startTimestamp: number,
  endTimestamp: number,
  windowLabel: string,
  validationMessage: string | null = null,
): SubscriptionBillingFilters {
  return {
    preset,
    startInput: formatSubscriptionDateTimeInput(startTimestamp),
    endInput: formatSubscriptionDateTimeInput(endTimestamp),
    startTimestamp,
    endTimestamp,
    windowLabel,
    validationMessage,
  };
}

function thisMonthFilters(
  nowSeconds: number,
  validationMessage: string | null = null,
): SubscriptionBillingFilters {
  const { year, month } = getShanghaiParts(nowSeconds);
  return boundedFilters(
    "this_month",
    shanghaiTimestamp(year, month, 1),
    nowSeconds,
    "本月",
    validationMessage,
  );
}

/**
 * Parses subscription billing filters independently from dashboard limits.
 * Every preset except `all` resolves to a bounded interval; invalid input safely falls back to this month.
 */
export function parseSubscriptionBillingFilters(
  searchParams: SubscriptionBillingSearchParams,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SubscriptionBillingFilters {
  const rawPreset = getFirstValue(searchParams.preset).trim();
  const preset = rawPreset ? parsePreset(rawPreset) : "this_month";

  if (!preset) {
    return thisMonthFilters(nowSeconds, "时间筛选参数无效，已回退到本月。");
  }

  const now = getShanghaiParts(nowSeconds);

  if (preset === "this_month") {
    return thisMonthFilters(nowSeconds);
  }

  if (preset === "last_month") {
    const startTimestamp = shanghaiTimestamp(now.year, now.month - 1, 1);
    const endTimestamp = shanghaiTimestamp(now.year, now.month, 1) - 1;
    return boundedFilters("last_month", startTimestamp, endTimestamp, "上月");
  }

  if (preset === "today") {
    return boundedFilters(
      "today",
      shanghaiTimestamp(now.year, now.month, now.day),
      nowSeconds,
      "今天",
    );
  }

  if (preset === "7d" || preset === "30d") {
    // Rolling durations ending at now: exactly 168 hours for 7d and 720 hours for 30d.
    // The SQL uses an inclusive, second-level closed interval, which is acceptable here.
    const days = preset === "7d" ? 7 : 30;
    return boundedFilters(
      preset,
      nowSeconds - days * DAY_SECONDS,
      nowSeconds,
      preset === "7d" ? "近 7 天" : "近 30 天",
    );
  }

  if (preset === "all") {
    return {
      preset: "all",
      startInput: "",
      endInput: "",
      startTimestamp: null,
      endTimestamp: null,
      windowLabel: "全部时间",
      validationMessage: null,
    };
  }

  const startInput = getFirstValue(searchParams.start).trim();
  const endInput = getFirstValue(searchParams.end).trim();
  const startTimestamp = parseShanghaiDateTimeInput(startInput, false);
  const endTimestamp = parseShanghaiDateTimeInput(endInput, true);

  if (
    startTimestamp === null ||
    endTimestamp === null ||
    startTimestamp > endTimestamp
  ) {
    return thisMonthFilters(nowSeconds, "自定义时间范围无效，已回退到本月。");
  }

  return {
    preset: "custom",
    startInput: formatSubscriptionDateTimeInput(startTimestamp),
    endInput: formatSubscriptionDateTimeInput(endTimestamp),
    startTimestamp,
    endTimestamp,
    windowLabel: `${formatSubscriptionDateTimeInput(startTimestamp)} 至 ${formatSubscriptionDateTimeInput(endTimestamp)}`,
    validationMessage: null,
  };
}
