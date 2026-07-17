import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DASHBOARD_ROLLUP_GRAINS } from "./rollup-config.ts";
import {
  decomposeDashboardRange,
  getClosedDashboardWatermark,
  getDashboardAllBucket,
  getDashboardHourBucket,
  getDashboardMinuteBucket,
  getDashboardShanghaiDayBucket,
  getDashboardThirtyDayRange,
} from "./rollup-time.ts";

describe("dashboard rollup time buckets", () => {
  it("floors unix seconds to UTC minute and hour buckets", () => {
    // 2024-01-01 16:30:45 UTC
    const ts = Date.UTC(2024, 0, 1, 16, 30, 45) / 1000;
    assert.equal(getDashboardMinuteBucket(ts), Date.UTC(2024, 0, 1, 16, 30, 0) / 1000);
    assert.equal(getDashboardHourBucket(ts), Date.UTC(2024, 0, 1, 16, 0, 0) / 1000);
  });

  it("floors to Asia/Shanghai calendar day and all-time bucket 0", () => {
    // 2024-01-02 00:30:45 Asia/Shanghai = 2024-01-01 16:30:45 UTC
    const ts = Date.UTC(2024, 0, 1, 16, 30, 45) / 1000;
    // Shanghai day start is 2024-01-02 00:00 CST = 2024-01-01 16:00 UTC
    assert.equal(getDashboardShanghaiDayBucket(ts), Date.UTC(2024, 0, 1, 16, 0, 0) / 1000);
    assert.equal(getDashboardAllBucket(), 0);
  });

  it("handles times just before Shanghai midnight correctly", () => {
    // 2024-01-01 15:59:59 UTC = 2024-01-01 23:59:59 CST -> previous Shanghai day
    const ts = Date.UTC(2024, 0, 1, 15, 59, 59) / 1000;
    assert.equal(getDashboardShanghaiDayBucket(ts), Date.UTC(2023, 11, 31, 16, 0, 0) / 1000);
  });
});

describe("dashboard rollup watermark and 30d range", () => {
  it("returns null watermark when nothing has been processed", () => {
    assert.equal(getClosedDashboardWatermark(null, 1_700_000_000), null);
  });

  it("anchors watermark to latest processed event and caps to latest closed minute", () => {
    // now = 12:34:45 -> latest closed minute exclusive end is 12:34:00
    const nowSeconds = Date.UTC(2024, 5, 15, 12, 34, 45) / 1000;
    const closedMinuteEnd = Date.UTC(2024, 5, 15, 12, 34, 0) / 1000;

    // Processed mid previous minute: watermark is the processed second (still closed)
    const processedEarlier = Date.UTC(2024, 5, 15, 12, 33, 20) / 1000;
    assert.equal(getClosedDashboardWatermark(processedEarlier, nowSeconds), processedEarlier);

    // Processed inside the open minute: capped to closed minute end
    const processedOpen = Date.UTC(2024, 5, 15, 12, 34, 10) / 1000;
    assert.equal(getClosedDashboardWatermark(processedOpen, nowSeconds), closedMinuteEnd);

    // Processed far in the future relative to now: still capped
    assert.equal(getClosedDashboardWatermark(nowSeconds + 3600, nowSeconds), closedMinuteEnd);
  });

  it("builds a 30-day window ending at the watermark", () => {
    const watermark = Date.UTC(2024, 5, 15, 12, 0, 0) / 1000;
    const range = getDashboardThirtyDayRange(watermark);
    assert.equal(range.end, watermark);
    assert.equal(range.start, watermark - 30 * 24 * 60 * 60);
  });
});

describe("dashboard range decomposition", () => {
  it("rejects non-minute-aligned or invalid ranges", () => {
    const aligned = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
    assert.throws(() => decomposeDashboardRange(aligned + 1, aligned + 120), /minute/i);
    assert.throws(() => decomposeDashboardRange(aligned, aligned + 90), /minute/i);
    assert.throws(() => decomposeDashboardRange(aligned, aligned), /invalid|empty|range/i);
    assert.throws(() => decomposeDashboardRange(aligned + 120, aligned), /invalid|empty|range/i);
  });

  it("uses only edge minutes for a short partial-hour range", () => {
    const start = Date.UTC(2024, 0, 1, 12, 15, 0) / 1000;
    const end = Date.UTC(2024, 0, 1, 12, 45, 0) / 1000;
    const segments = decomposeDashboardRange(start, end);
    assert.deepEqual(segments, [
      { grain: DASHBOARD_ROLLUP_GRAINS.minute, start, end },
    ]);
  });

  it("uses complete hours between partial edge minutes", () => {
    const start = Date.UTC(2024, 0, 1, 12, 15, 0) / 1000;
    const end = Date.UTC(2024, 0, 1, 15, 40, 0) / 1000;
    const segments = decomposeDashboardRange(start, end);
    assert.deepEqual(segments, [
      {
        grain: DASHBOARD_ROLLUP_GRAINS.minute,
        start,
        end: Date.UTC(2024, 0, 1, 13, 0, 0) / 1000,
      },
      {
        grain: DASHBOARD_ROLLUP_GRAINS.hour,
        start: Date.UTC(2024, 0, 1, 13, 0, 0) / 1000,
        end: Date.UTC(2024, 0, 1, 15, 0, 0) / 1000,
      },
      {
        grain: DASHBOARD_ROLLUP_GRAINS.minute,
        start: Date.UTC(2024, 0, 1, 15, 0, 0) / 1000,
        end,
      },
    ]);
  });

  it("prefers complete Shanghai days with hour and minute edges", () => {
    // Shanghai day boundary at 16:00 UTC.
    // start: 2024-01-01 15:30 UTC (still previous Shanghai day)
    // end:   2024-01-03 17:20 UTC
    const start = Date.UTC(2024, 0, 1, 15, 30, 0) / 1000;
    const end = Date.UTC(2024, 0, 3, 17, 20, 0) / 1000;
    const segments = decomposeDashboardRange(start, end);

    assert.deepEqual(segments, [
      // minutes to next hour / Shanghai day boundary
      {
        grain: DASHBOARD_ROLLUP_GRAINS.minute,
        start,
        end: Date.UTC(2024, 0, 1, 16, 0, 0) / 1000,
      },
      // two complete Shanghai days:
      // 2024-01-02 CST = [2024-01-01 16:00 UTC, 2024-01-02 16:00 UTC)
      // 2024-01-03 CST = [2024-01-02 16:00 UTC, 2024-01-03 16:00 UTC)
      {
        grain: DASHBOARD_ROLLUP_GRAINS.day,
        start: Date.UTC(2024, 0, 1, 16, 0, 0) / 1000,
        end: Date.UTC(2024, 0, 3, 16, 0, 0) / 1000,
      },
      // hours after days until trailing partial hour
      {
        grain: DASHBOARD_ROLLUP_GRAINS.hour,
        start: Date.UTC(2024, 0, 3, 16, 0, 0) / 1000,
        end: Date.UTC(2024, 0, 3, 17, 0, 0) / 1000,
      },
      // trailing minutes
      {
        grain: DASHBOARD_ROLLUP_GRAINS.minute,
        start: Date.UTC(2024, 0, 3, 17, 0, 0) / 1000,
        end,
      },
    ]);
  });

  it("covers multi-day ranges with multiple complete Shanghai days", () => {
    const start = Date.UTC(2024, 0, 1, 16, 0, 0) / 1000; // exact Shanghai day start
    const end = Date.UTC(2024, 0, 4, 16, 0, 0) / 1000; // three full Shanghai days later
    const segments = decomposeDashboardRange(start, end);
    assert.deepEqual(segments, [
      {
        grain: DASHBOARD_ROLLUP_GRAINS.day,
        start,
        end,
      },
    ]);
  });
});
