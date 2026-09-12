"use client";

/**
 * 配额窗口时间轴（移植自 CLIProxyAPI 管理中心）。
 *
 * 所有投影数学在 src/lib/quota/quota-timeline.ts；本文件只做布局。
 * 卡片回答"还剩多少"，这里回答"什么时候回来、是不是全挤在同一晚"。
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  buildTimelineLane,
  laneHasWindow,
  projectLane,
  timelineSpan,
  DAY_MS,
  type TimelineLane,
  type TimelineMode,
} from "@/lib/quota/quota-timeline";
import type { AuthFile } from "@/types/auth";
import type { ProviderType, QuotaState } from "@/types/quota";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

const PROVIDER_ACCENT: Record<ProviderType, string> = {
  antigravity: "#ea580c",
  claude: "#d97706",
  codex: "#2563eb",
  "gemini-cli": "#059669",
  kimi: "#7c3aed",
  minimax: "#0891b2",
  xai: "#db2777",
  zai: "#4f46e5",
  unknown: "#64748b",
};

const pad = (value: number) => String(value).padStart(2, "0");
const formatDay = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};
const formatTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 让页面上的"现在"自己前进：条的状态分类和竖线位置都依赖时钟。 */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export interface QuotaTimelineProps {
  entries: AuthFile[];
  quotas: Record<string, QuotaState>;
  providerFor: (file: AuthFile) => ProviderType;
}

export function QuotaTimeline({ entries, quotas, providerFor }: QuotaTimelineProps) {
  const [mode, setMode] = useState<TimelineMode>("weekly");
  const [offset, setOffset] = useState(0);
  const now = useNow();

  const span = useMemo(() => timelineSpan(mode, offset, now), [mode, offset, now]);
  const todayLabel = "今天";
  const navigationLabel = offset === 0 ? todayLabel : formatDay(span.startMs);

  const laneInputs = useMemo(
    () =>
      entries.map((entry) => ({
        name: entry.authIndex,
        displayName: entry.displayName,
        provider: providerFor(entry),
        quota: quotas[entry.authIndex],
      })),
    [entries, providerFor, quotas],
  );

  // 在至少一条已加载凭证给出真实配额窗口之前整体隐藏；
  // 一旦有数据，切换缩放即使无匹配泳道也保留面板。
  const hasAnyLane = useMemo(
    () => laneInputs.some((input) => laneHasWindow(buildTimelineLane(input))),
    [laneInputs],
  );

  const lanes = useMemo(
    () =>
      laneInputs
        .map((input) =>
          buildTimelineLane({
            ...input,
            // 周视图优先最长可读窗口；会话视图明确要真实的 5 小时窗口，
            // 更长的周期不得被重新解释成 5 小时重置。
            maxPeriodHours: mode === "session" ? 5 : span.days * 24,
          }),
        )
        .filter((lane) => laneHasWindow(lane) && (mode !== "session" || lane.periodHours === 5)),
    [laneInputs, mode, span.days],
  );

  /** 周视图每天一格；会话视图每 6 小时一格。 */
  const cells = useMemo(() => {
    const zoomed = mode === "session";
    const count = zoomed ? span.days * 4 : span.days;
    const cellMs = (span.endMs - span.startMs) / count;
    const todayStart = new Date(now).setHours(0, 0, 0, 0);

    return Array.from({ length: count }, (_, index) => {
      const at = span.startMs + index * cellMs;
      const date = new Date(at);
      const isDayStart = !zoomed || date.getHours() === 0;
      return {
        at,
        isDayStart,
        isToday: new Date(at).setHours(0, 0, 0, 0) === todayStart,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        weekday: `周${WEEKDAY_LABELS[date.getDay()]}`,
        label: isDayStart ? formatDay(at) : `${pad(date.getHours())}:00`,
      };
    });
  }, [mode, span, now]);

  const nowPercent =
    now >= span.startMs && now < span.endMs
      ? ((now - span.startMs) / (span.endMs - span.startMs)) * 100
      : null;

  if (!hasAnyLane) {
    return null;
  }

  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-start justify-between gap-3 pb-4">
        <div>
          <p className="ds-kicker">窗口</p>
          <h2 className="mt-3 text-[1.16rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)] sm:text-[1.45rem]">
            配额窗口
          </h2>
          <p className="mt-2 ds-mono text-[0.72rem] text-[var(--foreground-faint)]">
            {formatDay(span.startMs)} – {formatDay(span.endMs - DAY_MS)} ·{" "}
            {mode === "weekly" ? "两周" : "三天"}
            {offset === 0 ? " · 当前" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-full border border-[var(--surface-ring-soft)] bg-[var(--background-muted)] p-0.5">
            <button
              type="button"
              onClick={() => setOffset((value) => value - 1)}
              className="h-7 cursor-pointer rounded-full px-3 text-[0.76rem] text-[var(--foreground-soft)] transition hover:text-[var(--foreground)]"
              aria-label="上一期"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setOffset(0)}
              disabled={offset === 0}
              className="ds-mono h-7 cursor-pointer rounded-full px-3 text-[0.74rem] text-[var(--foreground-soft)] transition hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-50"
              aria-label={todayLabel}
              title={offset === 0 ? undefined : todayLabel}
            >
              {navigationLabel}
            </button>
            <button
              type="button"
              onClick={() => setOffset((value) => value + 1)}
              className="h-7 cursor-pointer rounded-full px-3 text-[0.76rem] text-[var(--foreground-soft)] transition hover:text-[var(--foreground)]"
              aria-label="下一期"
            >
              ›
            </button>
          </div>

          <div className="inline-flex items-center gap-0.5 rounded-full border border-[var(--surface-ring-soft)] bg-[var(--background-muted)] p-0.5" role="group">
            {(["weekly", "session"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setOffset(0); // 跨度尺寸不同，旧偏移没有意义
                }}
                className={`h-7 cursor-pointer rounded-full px-3 text-[0.76rem] transition ${
                  mode === value
                    ? "bg-[var(--background-elevated)] font-medium text-[var(--foreground)] shadow-[0_0_0_1px_var(--surface-ring-soft)]"
                    : "text-[var(--foreground-soft)] hover:text-[var(--foreground)]"
                }`}
              >
                {value === "weekly" ? "周" : "5小时"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[18px] border border-[var(--surface-ring-soft)] bg-[var(--background-elevated)]">
        <div className="min-w-[760px]">
          {lanes.length === 0 ? (
            <div className="grid min-h-24 place-items-center px-6 py-8 text-center text-[0.76rem] text-[var(--foreground-faint)]" role="status">
              当前筛选下没有上报 5 小时配额窗口的账号。
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[196px_1fr] border-b border-[var(--surface-ring-soft)]">
                <div className="flex items-end px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-faint)]">
                  账号
                </div>
                <div className="flex">
                  {cells.map((cell) => (
                    <div
                      key={cell.at}
                      className={`flex min-w-0 flex-1 flex-col items-center gap-px border-l border-[var(--surface-ring-soft)] px-0.5 py-1.5 ${
                        cell.isToday ? "bg-[var(--background-muted)]" : ""
                      }`}
                    >
                      <span className="min-h-3 text-[0.6rem] text-[var(--foreground-faint)]">
                        {cell.isDayStart ? cell.weekday : ""}
                      </span>
                      <span className="ds-mono whitespace-nowrap text-[0.68rem] font-semibold text-[var(--foreground-soft)]">
                        {cell.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {lanes.map((lane) => (
                <Lane
                  key={lane.name}
                  lane={lane}
                  span={span}
                  now={now}
                  mode={mode}
                  cells={cells}
                  nowPercent={nowPercent}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {lanes.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.7rem] text-[var(--foreground-faint)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-full bg-[var(--foreground-muted)] opacity-70" />
            当前窗口
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-full border border-dashed border-[var(--foreground-faint)]" />
            即将到来
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-full bg-[var(--foreground-faint)] opacity-30" />
            已结束
          </span>
          <span className="min-w-0 flex-1 basis-80">
            {mode === "weekly"
              ? "每条横杠是一个完整配额窗口，从开启画到重置；同时结束的泳道在抢同一天的额度。"
              : "每条横杠是一个 5 小时窗口；只有窗口在倒计时的账号会被投影，其余保持空白。"}
          </span>
        </div>
      ) : null}
    </section>
  );
}

interface LaneProps {
  lane: TimelineLane;
  span: { startMs: number; endMs: number; days: number };
  now: number;
  mode: TimelineMode;
  cells: Array<{ at: number; isWeekend: boolean; isDayStart: boolean }>;
  nowPercent: number | null;
}

function Lane({ lane, span, now, mode, cells, nowPercent }: LaneProps) {
  const windows = useMemo(
    () => projectLane(lane, span.startMs, span.endMs, now, mode),
    [lane, span, now, mode],
  );

  const accent = PROVIDER_ACCENT[lane.provider] || PROVIDER_ACCENT.unknown;

  // 亚天级窗口按小时标注——5 小时取整成天会是 "0d"。
  const periodLabel =
    mode === "session"
      ? "5h"
      : !lane.periodHours
        ? ""
        : lane.periodHours < 24
          ? `${Math.round(lane.periodHours)}h`
          : `${Math.round(lane.periodHours / 24)}d`;

  return (
    <div className="grid grid-cols-[196px_1fr] border-t border-[var(--surface-ring-soft)] transition hover:bg-[var(--background-muted)]">
      <div className="flex min-w-0 flex-col gap-1 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span className="truncate text-[0.78rem] font-semibold text-[var(--foreground)]" title={lane.displayName}>
            {lane.displayName}
          </span>
          {periodLabel ? (
            <span className="ds-mono shrink-0 rounded-full bg-[var(--background-muted)] px-1.5 text-[0.62rem] font-medium text-[var(--foreground-soft)]">
              {periodLabel}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {lane.limits.map((limit) => (
            <span
              key={limit.key}
              className="rounded-md bg-[var(--background-muted)] px-1.5 py-px text-[0.64rem] text-[var(--foreground-faint)]"
            >
              {limit.label}{" "}
              <b className="ds-mono font-semibold text-[var(--foreground-soft)]">{limit.remaining}%</b>
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex min-h-[46px] items-center">
        <div className="absolute inset-0 flex">
          {cells.map((cell) => (
            <span
              key={cell.at}
              className={`flex-1 border-l border-[var(--surface-ring-soft)] ${cell.isWeekend ? "bg-[var(--background-muted)]" : ""}`}
            />
          ))}
        </div>

        {nowPercent !== null ? (
          <div
            className="absolute bottom-0 top-0 z-[1] w-px bg-[var(--foreground-muted)] opacity-70"
            style={{ left: `${nowPercent}%` }}
          />
        ) : null}

        {windows.length === 0 ? (
          <span className="relative z-[2] pl-2.5 text-[0.7rem] text-[var(--foreground-faint)]">
            无倒计时窗口
          </span>
        ) : (
          windows.map((window) => {
            // 标签需要空间才读得清；太窄时条自己说话，细节在 tooltip 里。
            const showLabel = window.widthPercent > (mode === "session" ? 4.5 : 9);
            const endText =
              mode === "session"
                ? formatTime(window.endMs)
                : `${formatDay(window.endMs)} ${formatTime(window.endMs)}`;

            const liveStyle: CSSProperties =
              window.state === "live"
                ? {
                    backgroundColor: hexToRgba(accent, 0.26),
                    border: `1px solid ${hexToRgba(accent, 0.45)}`,
                    color: "var(--foreground)",
                  }
                : window.state === "next"
                  ? {
                      backgroundColor: "transparent",
                      border: `1px dashed ${hexToRgba(accent, 0.32)}`,
                      color: "var(--foreground-faint)",
                    }
                  : {
                      backgroundColor: hexToRgba(accent, 0.08),
                      border: "1px solid transparent",
                      color: "var(--foreground-faint)",
                    };

            return (
              <div
                key={window.startMs}
                className="absolute z-[2] flex h-[22px] items-center overflow-hidden whitespace-nowrap rounded-full px-2 text-[0.64rem]"
                style={{ ...liveStyle, left: `${window.leftPercent}%`, width: `${window.widthPercent}%` }}
                title={`${lane.displayName}\n${formatDay(window.startMs)} ${formatTime(
                  window.startMs,
                )} → ${formatDay(window.endMs)} ${formatTime(window.endMs)}${
                  window.remaining !== null ? `\n剩余 ${window.remaining}%` : ""
                }`}
              >
                {window.remaining !== null ? (
                  <span
                    className="pointer-events-none absolute bottom-0 left-0 top-0"
                    style={{ width: `${100 - window.remaining}%`, backgroundColor: hexToRgba(accent, 0.34) }}
                  />
                ) : null}
                {showLabel ? (
                  <span className="ds-mono relative overflow-hidden text-ellipsis">
                    {window.remaining !== null ? `${window.remaining}% · ` : ""}
                    {endText}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
