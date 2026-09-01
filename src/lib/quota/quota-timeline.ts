/**
 * 配额窗口时间轴：泳道推导与窗口投影。
 *
 * 移植自 CLIProxyAPI 管理中心（Cli-Proxy-API-Management-Center）的
 * quotaTimelineModel：卡片回答"还剩多少"，时间轴回答"额度什么时候回来、
 * 是不是全部挤在同一时刻重置"。四个凭证同晚重置与错开一周重置是完全
 * 不同的处境，任何单卡片百分比都表达不了这一点。
 *
 * 纯函数、无 React、不持有自己的时钟（now 由调用方传入），全部可直接单测。
 */

import type { ProviderType, QuotaState, RateLimitWindow } from "@/types/quota";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** 周视图跨两周；会话视图缩放到三天。 */
export type TimelineMode = "weekly" | "session";

export const TIMELINE_SPAN_DAYS: Record<TimelineMode, number> = {
  weekly: 14,
  session: 3,
};

/** 会话视图投影的滚动窗口时长（小时）。 */
const SESSION_PERIOD_HOURS = 5;

/** 泳道左列中的一条额度摘要。 */
export interface TimelineLimit {
  key: string;
  label: string;
  /** 剩余百分比 0..100。 */
  remaining: number | null;
}

/** 时间轴上的一条凭证泳道。 */
export interface TimelineLane {
  name: string;
  displayName: string;
  provider: ProviderType;
  /** 已知的窗口重置时刻；其余所有边界由它按整周期外推。 */
  anchorMs: number | null;
  /** 窗口时长（小时）。 */
  periodHours: number | null;
  /** 锚点窗口的剩余百分比。 */
  remaining: number | null;
  limits: TimelineLimit[];
}

/** 画出的一个窗口条：可见跨度内的单次窗口出现。 */
export interface TimelineWindow {
  startMs: number;
  endMs: number;
  /** 相对跨度的百分比 0..100，已裁剪到可见范围。 */
  leftPercent: number;
  widthPercent: number;
  state: "past" | "live" | "next";
  /** 仅 API 上报的当前窗口携带剩余百分比。 */
  remaining: number | null;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * 解析各 provider 混用的重置时间格式（ISO 字符串 / 毫秒 / 秒）为毫秒。
 * 数值按数量级判别单位：当前纪元秒约 1.7e9，毫秒约 1.7e12。
 */
export function parseQuotaResetTimeMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  let numeric = NaN;
  if (typeof value === "number") {
    numeric = value;
  } else {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      numeric = Number(trimmed);
    } else {
      const parsed = new Date(trimmed.replace(/(\.\d{6})\d+/, "$1")).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric > 1e11) return numeric;
  return numeric * 1000;
}

/**
 * 从窗口 id / 标签推断窗口时长（小时）。推断不出的返回 null——
 * 宁可少画一条泳道，也不能凭空发明周期。
 */
export function inferWindowPeriodHours(
  id: string | null | undefined,
  label: string | null | undefined,
): number | null {
  const text = `${id ?? ""} ${label ?? ""}`.toLowerCase();
  if (!text.trim()) return null;

  // 月度是账单周期（消费上限滚动），不是限流容量回归，不进时间轴。
  if (/月|month/.test(text)) return null;

  if (/five[-\s]?hour/.test(text)) return 5;
  // 注意：不能用 \b —— 小时/天等 CJK 字符属于非单词字符，\b 在其后失效。
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*[-\s]?(?:小时|hours?|h)(?![a-z0-9])/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    return hours > 0 && hours <= 24 * 31 ? hours : null;
  }

  if (/seven[-\s]?day|周|week/.test(text)) return 168;

  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*[-\s]?(?:天|days?|d)(?![a-z0-9])/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    return days > 0 && days <= 31 ? days * 24 : null;
  }

  if (/daily|每天/.test(text)) return 24;
  if (/hour|小时/.test(text)) return 1;

  return null;
}

/**
 * 以 anchorMs 为基准，按 periodMs 整周期前后外推，覆盖 [fromMs, toMs] 的
 * 全部窗口边界。带迭代上限防护，坏数据不会把这里变成百万次循环。
 */
export function windowsIn(
  anchorMs: number,
  periodMs: number,
  fromMs: number,
  toMs: number,
): Array<{ startMs: number; endMs: number }> {
  if (!Number.isFinite(anchorMs) || !(periodMs > 0)) return [];
  if (!(toMs > fromMs)) return [];

  const maxWindows = Math.ceil((toMs - fromMs) / periodMs) + 2;
  if (maxWindows > 1000) return [];

  let end = anchorMs + Math.ceil((fromMs - anchorMs) / periodMs) * periodMs;
  const out: Array<{ startMs: number; endMs: number }> = [];
  while (end - periodMs < toMs) {
    out.push({ startMs: end - periodMs, endMs: end });
    end += periodMs;
  }
  return out;
}

/** ms 所在本地日的零点。 */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ms 所在本地周（周日）的零点。 */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

/**
 * 模式与偏移对应的可见跨度。周视图从所在周日按周步进；会话视图从今天
 * 按天步进。用日期算术而非固定毫秒累加，跨夏令时不会整体偏移一小时。
 */
export function timelineSpan(
  mode: TimelineMode,
  offset: number,
  now: number,
): { startMs: number; endMs: number; days: number } {
  const days = TIMELINE_SPAN_DAYS[mode];
  const base = new Date(mode === "weekly" ? startOfWeek(now) : startOfDay(now));
  base.setDate(base.getDate() + offset * (mode === "weekly" ? 7 : 1));
  const startMs = base.getTime();

  const end = new Date(startMs);
  end.setDate(end.getDate() + days);

  return { startMs, endMs: end.getTime(), days };
}

interface WindowLike {
  resetTimeMs: number | null;
  periodHours: number | null;
}

/**
 * 选出驱动泳道的窗口：周期最适合可见跨度者优先，同周期取最早重置。
 *
 * 直接取最早重置的窗口看似直观实则不可读：两周视里 5 小时窗口永远最先
 * 到期，每条泳道都会碎成细条而不是两根可读的周条。长窗口正是两周视图
 * 存在的意义；会话视图则专为看短窗口。
 */
export function pickLaneWindow<T extends WindowLike>(
  windows: readonly T[],
  maxPeriodHours?: number,
): T | null {
  const usable = windows.filter(
    (window) => window.resetTimeMs !== null && Number.isFinite(window.resetTimeMs),
  );
  if (usable.length === 0) return null;

  const periodOf = (window: T) =>
    typeof window.periodHours === "number" && window.periodHours > 0 ? window.periodHours : 0;

  const fitting =
    maxPeriodHours === undefined
      ? usable
      : usable.filter((window) => periodOf(window) <= maxPeriodHours);

  const pool = fitting.length > 0 ? fitting : usable;
  return pool.reduce((best, window) => {
    const byPeriod = periodOf(window) - periodOf(best);
    if (byPeriod !== 0) return byPeriod > 0 ? window : best;
    return (window.resetTimeMs as number) < (best.resetTimeMs as number) ? window : best;
  });
}

/**
 * 把一条泳道的窗口投影到跨度上，裁剪并定位。
 * 完全落在跨度外的窗口被丢弃（而非返回零宽），调用方可用空结果表示"无可绘制"。
 */
export function projectLane(
  lane: TimelineLane,
  spanStartMs: number,
  spanEndMs: number,
  now: number,
  mode: TimelineMode,
): TimelineWindow[] {
  const periodHours = lane.periodHours;
  if (lane.anchorMs === null || !periodHours) return [];
  if (mode === "session" && periodHours !== SESSION_PERIOD_HOURS) return [];

  const span = spanEndMs - spanStartMs;
  if (span <= 0) return [];

  const toPercent = (ms: number) => ((ms - spanStartMs) / span) * 100;

  return windowsIn(lane.anchorMs, periodHours * HOUR_MS, spanStartMs, spanEndMs)
    .map((window): TimelineWindow | null => {
      const left = Math.max(0, toPercent(window.startMs));
      const right = Math.min(100, toPercent(window.endMs));
      if (right <= 0 || left >= 100 || right <= left) return null;

      const state: TimelineWindow["state"] =
        window.endMs <= now ? "past" : window.startMs <= now ? "live" : "next";

      return {
        startMs: window.startMs,
        endMs: window.endMs,
        leftPercent: left,
        widthPercent: right - left,
        state,
        // remaining 属于锚点所在的当前窗口；该窗口重置过后，投影窗口不得复用。
        remaining: state === "live" && window.endMs === lane.anchorMs ? lane.remaining : null,
      };
    })
    .filter((window): window is TimelineWindow => window !== null);
}

/** 泳道是否有任何可画内容（任意模式下）。没有锚点就永远画不出条。 */
export function laneHasWindow(lane: TimelineLane): boolean {
  return lane.anchorMs !== null;
}

/** 泳道构建输入。quota 直接注入而不是挂在 entry 上，与卡片读同一份状态。 */
export interface TimelineLaneInput {
  name: string;
  displayName: string;
  provider: ProviderType;
  quota: QuotaState | undefined;
  /** 视图约束：值得画的最长窗口周期（小时），通常传可见跨度。 */
  maxPeriodHours?: number;
}

interface LaneWindowSource extends WindowLike {
  key: string;
  label: string;
  remaining: number | null;
}

function windowRemaining(window: RateLimitWindow): number | null {
  const explicit = window.remainingPercent ?? window.remaining_percent;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return clampPercent(explicit);

  const used = window.usedPercent ?? window.used_percent;
  if (typeof used === "number" && Number.isFinite(used)) return clampPercent(100 - used);
  return null;
}

/**
 * 把各 provider 的配额数据统一收集成窗口来源。
 * monitor 的数据比 CPAMC 规整得多：大多数 provider 已经归一成 windows，
 * 只有 antigravity（groups）、gemini-cli（buckets）、kimi（rows）需要特判。
 */
export function collectLaneWindows(
  quota: QuotaState | undefined,
  provider: ProviderType,
): LaneWindowSource[] {
  const data = quota?.data;
  if (!data) return [];

  const out: LaneWindowSource[] = [];

  if (Array.isArray(data.windows)) {
    data.windows.forEach((window, index) => {
      out.push({
        key: window.id || window.label || `window-${index}`,
        label: window.label || window.id || "窗口",
        remaining: windowRemaining(window),
        resetTimeMs: parseQuotaResetTimeMs(
          window.resetTime ?? window.reset_time ?? window.reset_at ?? window.resetAt,
        ),
        periodHours: inferWindowPeriodHours(window.id, window.label),
      });
    });
  }

  if (provider === "antigravity" && Array.isArray(data.groups)) {
    data.groups.forEach((group) => {
      const remaining =
        typeof group.remainingFraction === "number" && Number.isFinite(group.remainingFraction)
          ? clampPercent(Math.round(group.remainingFraction * 100))
          : null;
      out.push({
        key: `group-${group.id}`,
        label: group.label || group.id,
        remaining,
        resetTimeMs: parseQuotaResetTimeMs(group.resetTime),
        periodHours: 24,
      });
    });
  }

  if (provider === "gemini-cli" && Array.isArray(data.buckets)) {
    data.buckets.forEach((bucket, index) => {
      const remaining =
        typeof bucket.remainingFraction === "number" && Number.isFinite(bucket.remainingFraction)
          ? clampPercent(Math.round(bucket.remainingFraction * 100))
          : null;
      out.push({
        key: bucket.id || `bucket-${index}`,
        label: bucket.label || bucket.id || "配额",
        remaining,
        resetTimeMs: parseQuotaResetTimeMs(bucket.resetTime ?? bucket.reset_time),
        periodHours: 24,
      });
    });
  }

  if (provider === "kimi" && Array.isArray(data.rows)) {
    data.rows.forEach((row, index) => {
      const remaining =
        row.limit > 0 ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100)) : null;
      out.push({
        key: row.id || `row-${index}`,
        label: row.label || "窗口",
        remaining,
        resetTimeMs: parseQuotaResetTimeMs(row.resetTime),
        periodHours: inferWindowPeriodHours(row.id, row.label),
      });
    });
  }

  return out;
}

/**
 * 为一条凭证构建泳道。没有可用重置时刻的 provider 产出空锚点泳道，
 * 渲染时被隐藏——卡片网格已经枚举了所有凭证，空白泳道只增加噪音。
 */
export function buildTimelineLane(input: TimelineLaneInput): TimelineLane {
  const { name, displayName, provider, quota, maxPeriodHours } = input;
  const empty: TimelineLane = {
    name,
    displayName,
    provider,
    anchorMs: null,
    periodHours: null,
    remaining: null,
    limits: [],
  };

  const sources = collectLaneWindows(quota, provider);
  const usable = sources.filter((source) => source.resetTimeMs !== null);
  if (usable.length === 0) return empty;

  // Codex 可能上报与账户窗口同周期的模型级窗口（如某模型周窗口）；
  // 同周期并列时按 id 会平局切到模型配额上，显式优先账户窗口。
  const preferredId = maxPeriodHours !== undefined && maxPeriodHours <= SESSION_PERIOD_HOURS
    ? "codex-five-hour"
    : "codex-weekly";
  const preferred =
    provider === "codex"
      ? usable.find(
          (source) =>
            source.key === preferredId &&
            source.periodHours !== null &&
            (maxPeriodHours === undefined || source.periodHours <= maxPeriodHours),
        )
      : undefined;

  const chosen = preferred ?? pickLaneWindow(usable, maxPeriodHours);
  if (!chosen) return empty;

  return {
    ...empty,
    anchorMs: chosen.resetTimeMs,
    periodHours: chosen.periodHours,
    remaining: chosen.remaining,
    limits: sources
      .filter((source) => source.remaining !== null)
      .map((source) => ({
        key: source.key,
        label: source.label,
        remaining: source.remaining,
      })),
  };
}
