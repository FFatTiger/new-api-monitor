import { DASHBOARD_ROLLUP_GRAINS } from "./rollup-config.ts";
import type { DashboardRollupRangeSegment } from "./types.ts";

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const SHANGHAI_OFFSET_SECONDS = 8 * HOUR_SECONDS;
const THIRTY_DAYS_SECONDS = 30 * DAY_SECONDS;

function floorTo(value: number, unit: number): number {
  return Math.floor(value / unit) * unit;
}

function ceilTo(value: number, unit: number): number {
  return Math.ceil(value / unit) * unit;
}

function assertFiniteSeconds(label: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite unix timestamp in seconds`);
  }
  return value;
}

export function getDashboardMinuteBucket(ts: number): number {
  return floorTo(Math.floor(assertFiniteSeconds("ts", ts)), MINUTE_SECONDS);
}

export function getDashboardHourBucket(ts: number): number {
  return floorTo(Math.floor(assertFiniteSeconds("ts", ts)), HOUR_SECONDS);
}

/**
 * Asia/Shanghai calendar day start as a unix timestamp (UTC seconds).
 * Uses fixed +08:00 (China Standard Time; no DST).
 */
export function getDashboardShanghaiDayBucket(ts: number): number {
  const floored = Math.floor(assertFiniteSeconds("ts", ts));
  const shifted = floored + SHANGHAI_OFFSET_SECONDS;
  const dayStartShifted = floorTo(shifted, DAY_SECONDS);
  return dayStartShifted - SHANGHAI_OFFSET_SECONDS;
}

export function getDashboardAllBucket(): number {
  return 0;
}

/**
 * Minute-aligned exclusive end of the latest data-supported closed minute.
 *
 * - processedExclusiveEnd = floor(maxProcessedCreatedAt/60)*60 + 60
 * - latestClosedMinuteEnd = floor(now/60)*60
 * - return min(processedExclusiveEnd, latestClosedMinuteEnd)
 */
export function getClosedDashboardWatermark(
  maxProcessedCreatedAt: number | null,
  nowSeconds: number,
): number | null {
  if (maxProcessedCreatedAt === null) return null;
  assertFiniteSeconds("maxProcessedCreatedAt", maxProcessedCreatedAt);
  assertFiniteSeconds("nowSeconds", nowSeconds);
  const processedExclusiveEnd =
    floorTo(maxProcessedCreatedAt, MINUTE_SECONDS) + MINUTE_SECONDS;
  const latestClosedMinuteEnd = floorTo(Math.floor(nowSeconds), MINUTE_SECONDS);
  return Math.min(processedExclusiveEnd, latestClosedMinuteEnd);
}

export function getDashboardThirtyDayRange(watermark: number): {
  start: number;
  end: number;
} {
  assertFiniteSeconds("watermark", watermark);
  return {
    start: watermark - THIRTY_DAYS_SECONDS,
    end: watermark,
  };
}

function isMinuteAligned(value: number): boolean {
  return Number.isFinite(value) && value % MINUTE_SECONDS === 0;
}

function nextShanghaiDayBoundary(ts: number): number {
  const dayStart = getDashboardShanghaiDayBucket(ts);
  return dayStart === ts ? ts : dayStart + DAY_SECONDS;
}

/**
 * Decompose [start, end) into non-overlapping segments using complete
 * Shanghai days, complete hours, and edge minutes. Both ends must be
 * minute-aligned; end must be strictly greater than start.
 *
 * Preference order when covering a span:
 * 1. complete Shanghai days where they fully fit
 * 2. complete hours on the edges around those days
 * 3. edge minutes for partial hours
 */
export function decomposeDashboardRange(
  start: number,
  end: number,
): DashboardRollupRangeSegment[] {
  assertFiniteSeconds("start", start);
  assertFiniteSeconds("end", end);

  if (!isMinuteAligned(start) || !isMinuteAligned(end)) {
    throw new RangeError("range bounds must be minute-aligned unix seconds");
  }
  if (end <= start) {
    throw new RangeError("invalid range: end must be greater than start");
  }

  const segments: DashboardRollupRangeSegment[] = [];
  let cursor = start;

  const push = (grain: DashboardRollupRangeSegment["grain"], from: number, to: number) => {
    if (to > from) {
      segments.push({ grain, start: from, end: to });
    }
  };

  // Leading partial hour → minutes until next hour boundary (or end).
  if (cursor % HOUR_SECONDS !== 0) {
    const minuteEnd = Math.min(ceilTo(cursor, HOUR_SECONDS), end);
    push(DASHBOARD_ROLLUP_GRAINS.minute, cursor, minuteEnd);
    cursor = minuteEnd;
  }
  if (cursor >= end) return segments;

  // Hours until the first Shanghai day boundary that can start a day segment.
  const firstDayBoundary = nextShanghaiDayBoundary(cursor);
  if (firstDayBoundary > cursor && firstDayBoundary <= end) {
    // cursor is hour-aligned; emit complete hours up to the day boundary.
    push(DASHBOARD_ROLLUP_GRAINS.hour, cursor, firstDayBoundary);
    cursor = firstDayBoundary;
  } else if (firstDayBoundary > end) {
    // No complete day can start; remaining complete hours then minutes.
    const hourEnd = floorTo(end, HOUR_SECONDS);
    if (hourEnd > cursor) {
      push(DASHBOARD_ROLLUP_GRAINS.hour, cursor, hourEnd);
      cursor = hourEnd;
    }
    if (cursor < end) {
      push(DASHBOARD_ROLLUP_GRAINS.minute, cursor, end);
    }
    return segments;
  }

  // Emit complete Shanghai days while a full day fits before `end`.
  if (cursor === getDashboardShanghaiDayBucket(cursor)) {
    let dayEnd = cursor;
    while (dayEnd + DAY_SECONDS <= end) {
      dayEnd += DAY_SECONDS;
    }
    if (dayEnd > cursor) {
      push(DASHBOARD_ROLLUP_GRAINS.day, cursor, dayEnd);
      cursor = dayEnd;
    }
  }

  // Remaining complete hours after day block.
  if (cursor < end) {
    const hourEnd = floorTo(end, HOUR_SECONDS);
    if (hourEnd > cursor) {
      push(DASHBOARD_ROLLUP_GRAINS.hour, cursor, hourEnd);
      cursor = hourEnd;
    }
  }

  // Trailing minutes.
  if (cursor < end) {
    push(DASHBOARD_ROLLUP_GRAINS.minute, cursor, end);
  }

  return segments;
}
