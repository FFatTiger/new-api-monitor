import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSubscriptionBillingFilters } from "./subscription-billing-filters.ts";

const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;

function shanghaiSeconds(value: string): number {
  return Date.parse(`${value}+08:00`) / 1000;
}

describe("parseSubscriptionBillingFilters", () => {
  it("defaults to the current calendar month in Asia/Shanghai", () => {
    const now = shanghaiSeconds("2025-03-18T12:34:56");
    const filters = parseSubscriptionBillingFilters({}, now);

    assert.equal(filters.preset, "this_month");
    assert.equal(filters.startTimestamp, shanghaiSeconds("2025-03-01T00:00:00"));
    assert.equal(filters.endTimestamp, now);
    assert.equal(filters.windowLabel, "本月");
    assert.equal(filters.validationMessage, null);
  });

  it("resolves last month across a year boundary", () => {
    const now = shanghaiSeconds("2025-01-15T08:00:00");
    const filters = parseSubscriptionBillingFilters({ preset: "last_month" }, now);

    assert.equal(filters.startTimestamp, shanghaiSeconds("2024-12-01T00:00:00"));
    assert.equal(filters.endTimestamp, shanghaiSeconds("2024-12-31T23:59:59"));
    assert.equal(filters.windowLabel, "上月");
  });

  it("parses custom datetime-local inputs as Shanghai time", () => {
    const filters = parseSubscriptionBillingFilters(
      {
        preset: "custom",
        start: "2024-06-01T00:00",
        end: "2024-06-02T12:30",
      },
      shanghaiSeconds("2025-03-18T12:34:56"),
    );

    assert.equal(filters.preset, "custom");
    assert.equal(filters.startTimestamp, Date.UTC(2024, 5, 1, 0, 0) / 1000 - SHANGHAI_OFFSET_SECONDS);
    assert.equal(filters.endTimestamp, shanghaiSeconds("2024-06-02T12:30:59"));
    assert.equal(filters.startInput, "2024-06-01T00:00");
    assert.equal(filters.endInput, "2024-06-02T12:30");
  });

  it("falls back to a bounded current month for invalid custom input", () => {
    const now = shanghaiSeconds("2025-03-18T12:34:56");
    for (const params of [
      { preset: "custom", start: "not-a-date", end: "" },
      { preset: "custom", start: "2025-03-20T00:00", end: "2025-03-19T00:00" },
      { preset: "custom", start: "2025-02-30T00:00", end: "2025-03-01T00:00" },
      { preset: "custom", start: "2025-03-01T00:00 trailing", end: "2025-03-02T00:00" },
      { preset: "custom", start: "2025-03-01T00:00", end: "2025-03-02T00:00 trailing" },
      { preset: "unexpected" },
    ]) {
      const filters = parseSubscriptionBillingFilters(params, now);
      assert.equal(filters.preset, "this_month");
      assert.equal(filters.startTimestamp, shanghaiSeconds("2025-03-01T00:00:00"));
      assert.equal(filters.endTimestamp, now);
      assert.match(filters.validationMessage ?? "", /无效|回退/);
    }
  });

  it("uses Shanghai-day boundaries for today", () => {
    const midnight = shanghaiSeconds("2025-03-18T00:00:00");
    const atMidnight = parseSubscriptionBillingFilters({ preset: "today" }, midnight);
    assert.equal(atMidnight.startTimestamp, midnight);
    assert.equal(atMidnight.endTimestamp, midnight);

    const endOfDay = shanghaiSeconds("2025-03-18T23:59:59");
    const later = parseSubscriptionBillingFilters({ preset: "today" }, endOfDay);
    assert.equal(later.startTimestamp, midnight);
    assert.equal(later.endTimestamp, endOfDay);
  });

  it("uses rolling 168-hour and 720-hour boundaries", () => {
    const now = shanghaiSeconds("2025-03-18T12:34:56");
    const sevenDays = parseSubscriptionBillingFilters({ preset: "7d" }, now);
    const thirtyDays = parseSubscriptionBillingFilters({ preset: "30d" }, now);

    assert.equal(sevenDays.startTimestamp, now - 168 * 60 * 60);
    assert.equal(sevenDays.endTimestamp, now);
    assert.equal(thirtyDays.startTimestamp, now - 720 * 60 * 60);
    assert.equal(thirtyDays.endTimestamp, now);
  });

  it("keeps all-time as the only unbounded preset", () => {
    const filters = parseSubscriptionBillingFilters(
      { preset: "all" },
      shanghaiSeconds("2025-03-18T12:34:56"),
    );

    assert.equal(filters.startTimestamp, null);
    assert.equal(filters.endTimestamp, null);
    assert.equal(filters.windowLabel, "全部时间");
  });
});
