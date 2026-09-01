import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTimelineLane,
  inferWindowPeriodHours,
  laneHasWindow,
  parseQuotaResetTimeMs,
  pickLaneWindow,
  projectLane,
  timelineSpan,
  windowsIn,
  DAY_MS,
  HOUR_MS,
} from "./quota-timeline.ts";

const T0 = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01T00:00Z

describe("quota timeline reset time parsing", () => {
  it("accepts ISO strings, milliseconds and epoch seconds", () => {
    assert.equal(parseQuotaResetTimeMs("2026-09-01T12:00:00Z"), Date.UTC(2026, 8, 1, 12));
    assert.equal(parseQuotaResetTimeMs(1_800_000_000_000), 1_800_000_000_000);
    assert.equal(parseQuotaResetTimeMs("1800000000"), 1_800_000_000_000);
    assert.equal(parseQuotaResetTimeMs(1_800_000_000), 1_800_000_000_000);
  });

  it("rejects junk values", () => {
    assert.equal(parseQuotaResetTimeMs(""), null);
    assert.equal(parseQuotaResetTimeMs("not-a-date"), null);
    assert.equal(parseQuotaResetTimeMs(0), null);
    assert.equal(parseQuotaResetTimeMs(Number.NaN), null);
    assert.equal(parseQuotaResetTimeMs(null), null);
    assert.equal(parseQuotaResetTimeMs(undefined), null);
  });
});

describe("quota timeline period inference", () => {
  it("maps monitor window ids and labels to periods", () => {
    assert.equal(inferWindowPeriodHours("codex-five-hour", "5小时窗口"), 5);
    assert.equal(inferWindowPeriodHours("codex-weekly", "周窗口"), 168);
    assert.equal(inferWindowPeriodHours("five-hour", "5小时窗口"), 5);
    assert.equal(inferWindowPeriodHours("seven-day", "7天窗口"), 168);
    assert.equal(inferWindowPeriodHours("seven-day-opus", "Opus 7天"), 168);
    assert.equal(inferWindowPeriodHours("tokens-limit", "5小时额度"), 5);
    assert.equal(inferWindowPeriodHours("time-limit", "周额度"), 168);
    assert.equal(inferWindowPeriodHours("minimax-hour", "小时额度"), 1);
    assert.equal(inferWindowPeriodHours("minimax-week", "周额度"), 168);
    assert.equal(inferWindowPeriodHours("grok-credits", "3天额度"), 72);
    assert.equal(inferWindowPeriodHours("", "周窗口"), 168);
  });

  it("refuses to invent periods for billing cycles or unknown labels", () => {
    assert.equal(inferWindowPeriodHours("monthly", "月度额度"), null);
    assert.equal(inferWindowPeriodHours("iguana-necktie", "Iguana Necktie"), null);
    assert.equal(inferWindowPeriodHours(undefined, undefined), null);
  });
});

describe("quota timeline window projection", () => {
  it("aligns window boundaries to the anchor by whole periods", () => {
    // 首尾与区间边缘相切的窗口也会出现；projectLane 负责把零重叠的裁掉。
    const windows = windowsIn(T0, 5 * HOUR_MS, T0 - 10 * HOUR_MS, T0 + 6 * HOUR_MS);
    assert.equal(windows.length, 5);
    assert.deepEqual(windows[0], { startMs: T0 - 15 * HOUR_MS, endMs: T0 - 10 * HOUR_MS });
    assert.equal(windows.at(-1)?.endMs, T0 + 10 * HOUR_MS);
    assert.ok(windows.every((window, index) => index === 0 || windows[index - 1].endMs === window.startMs));
  });

  it("guards pathological periods", () => {
    assert.deepEqual(windowsIn(T0, 0, T0, T0 + HOUR_MS), []);
    assert.deepEqual(windowsIn(T0, 1, T0, T0 + 1e9), []);
  });

  it("steps weekly spans from the containing Sunday (local time)", () => {
    const wednesday = new Date(2026, 8, 2, 15).getTime(); // 2026-09-02 周三
    const span = timelineSpan("weekly", 0, wednesday);
    const startDate = new Date(span.startMs);
    assert.equal(startDate.getDay(), 0); // 本地周日
    assert.equal(startDate.getHours(), 0); // 本地零点
    assert.equal(span.days, 14);
    assert.equal(span.endMs - span.startMs, 14 * DAY_MS);

    const next = timelineSpan("weekly", 1, wednesday);
    assert.equal(next.startMs - span.startMs, 7 * DAY_MS);
  });

  it("steps session spans by a single day", () => {
    const span = timelineSpan("session", 0, T0);
    const next = timelineSpan("session", 1, T0);
    assert.equal(span.days, 3);
    assert.equal(next.startMs - span.startMs, DAY_MS);
  });
});

describe("quota timeline lane picking", () => {
  const fiveHour = { resetTimeMs: T0 + 3 * HOUR_MS, periodHours: 5 };
  const weekly = { resetTimeMs: T0 + 5 * DAY_MS, periodHours: 168 };

  it("prefers the longest window that fits the span", () => {
    assert.equal(pickLaneWindow([fiveHour, weekly], 168), weekly);
    assert.equal(pickLaneWindow([fiveHour, weekly], 5), fiveHour);
  });

  it("falls back to the shortest usable window when nothing fits", () => {
    assert.equal(pickLaneWindow([weekly], 5), weekly);
  });

  it("breaks period ties by soonest reset", () => {
    const other = { resetTimeMs: T0 + DAY_MS, periodHours: 168 };
    assert.equal(pickLaneWindow([weekly, other], 168), other);
  });

  it("ignores windows without a reset instant", () => {
    assert.equal(pickLaneWindow([{ resetTimeMs: null, periodHours: 5 }]), null);
    assert.equal(pickLaneWindow([]), null);
  });
});

describe("quota timeline lane projection", () => {
  const span = { startMs: T0, endMs: T0 + 14 * DAY_MS, days: 14 };
  const now = T0 + 2 * DAY_MS;

  it("clips, positions and classifies windows", () => {
    const lane = {
      name: "a",
      displayName: "A",
      provider: "codex" as const,
      anchorMs: T0 + 5 * DAY_MS,
      periodHours: 168,
      remaining: 40,
      limits: [],
    };

    const windows = projectLane(lane, span.startMs, span.endMs, now, "weekly");
    assert.equal(windows.length, 3); // live, next, next（跨在 span 之前的 past 窗口被裁掉）
    assert.equal(windows[0].state, "live");
    assert.equal(windows[1].state, "next");
    assert.equal(windows[2].state, "next");
    assert.equal(windows[0].remaining, 40); // 结束于锚点的当前窗口携带剩余百分比
    assert.equal(windows[1].remaining, null);
    assert.equal(windows[2].remaining, null);
    assert.ok(windows.every((window) => window.leftPercent >= 0 && window.widthPercent > 0));
  });

  it("keeps session mode to genuine 5-hour windows only", () => {
    const weeklyLane = {
      name: "w",
      displayName: "W",
      provider: "claude" as const,
      anchorMs: T0 + DAY_MS,
      periodHours: 168,
      remaining: 30,
      limits: [],
    };
    assert.deepEqual(projectLane(weeklyLane, span.startMs, span.endMs, now, "session"), []);
  });
});

describe("quota timeline lane building from monitor quota shapes", () => {
  it("builds a codex lane anchored on the account window", () => {
    const lane = buildTimelineLane({
      name: "1",
      displayName: "codex-1",
      provider: "codex",
      maxPeriodHours: 168,
      quota: {
        loading: false,
        data: {
          windows: [
            { id: "codex-five-hour", label: "5小时窗口", usedPercent: 60, resetTime: 1_800_000_000_000 },
            { id: "codex-weekly", label: "周窗口", usedPercent: 20, resetTime: 1_800_100_000_000 },
            { id: "gpt-weekly-weekly-0", label: "GPT 周窗口", usedPercent: 10, resetTime: 1_800_050_000_000 },
          ],
        },
      },
    });

    assert.ok(laneHasWindow(lane));
    // 同为周周期时优先账户窗口，而不是模型级窗口。
    assert.equal(lane.anchorMs, 1_800_100_000_000);
    assert.equal(lane.periodHours, 168);
    assert.equal(lane.remaining, 80);
    assert.equal(lane.limits.length, 3);
  });

  it("builds lanes for kimi rows, gemini buckets and antigravity groups", () => {
    const kimi = buildTimelineLane({
      name: "k",
      displayName: "kimi-1",
      provider: "kimi",
      quota: { loading: false, data: { rows: [{ id: "summary", label: "周窗口", used: 25, limit: 100, resetTime: 1_800_100_000_000 }] } },
    });
    assert.equal(kimi.anchorMs, 1_800_100_000_000);
    assert.equal(kimi.periodHours, 168);
    assert.equal(kimi.remaining, 75);

    const gemini = buildTimelineLane({
      name: "g",
      displayName: "gemini-1",
      provider: "gemini-cli",
      quota: { loading: false, data: { buckets: [{ id: "gemini-pro", label: "Gemini Pro", remainingFraction: 0.55, resetTime: "2026-09-03T00:00:00Z" }] } },
    });
    assert.equal(gemini.periodHours, 24);
    assert.equal(gemini.remaining, 55);

    const antigravity = buildTimelineLane({
      name: "a",
      displayName: "ag-1",
      provider: "antigravity",
      quota: { loading: false, data: { groups: [{ id: "claude", label: "Claude", models: [], remainingFraction: 0.3, resetTime: 1_800_100_000_000 }] } },
    });
    assert.equal(antigravity.remaining, 30);
  });

  it("yields an empty lane without usable reset instants", () => {
    const lane = buildTimelineLane({
      name: "z",
      displayName: "zai-1",
      provider: "zai",
      quota: { loading: false, data: { windows: [{ id: "tokens-limit", label: "5小时额度", usedPercent: 10 }] } },
    });
    assert.equal(laneHasWindow(lane), false);
    assert.equal(lane.anchorMs, null);

    const missing = buildTimelineLane({ name: "m", displayName: "m", provider: "zai", quota: undefined });
    assert.equal(laneHasWindow(missing), false);
  });
});
