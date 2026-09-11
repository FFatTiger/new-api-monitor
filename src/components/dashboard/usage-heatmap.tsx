"use client";

/**
 * 用量热力图（本地 星期 × 小时）+ 关键速率指标。
 *
 * 数据来自趋势查询返回的同一批行（按 bucket + 星期 + 小时分桶），所以
 * 不额外增加 ClickHouse 扫描：趋势图看“什么时候”，热力图看“规律”。
 */

import { useMemo } from "react";

import { formatCompactNumberStr, formatPercent, getCacheRatio } from "@/lib/format";
import type { HeatmapCell, TrendPoint } from "@/lib/queries/dashboard";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
/** 从 00:00 起按 3 小时合并显示，24 列在窄屏上无法辨读。 */
const HOUR_GROUPS = [
  { label: "00", hours: [0, 1, 2] },
  { label: "03", hours: [3, 4, 5] },
  { label: "06", hours: [6, 7, 8] },
  { label: "09", hours: [9, 10, 11] },
  { label: "12", hours: [12, 13, 14] },
  { label: "15", hours: [15, 16, 17] },
  { label: "18", hours: [18, 19, 20] },
  { label: "21", hours: [21, 22, 23] },
];

interface UsageHeatmapProps {
  cells: HeatmapCell[];
  trend: TrendPoint[];
  granularity: "hour" | "day";
}

export function UsageHeatmap({ cells, trend, granularity }: UsageHeatmapProps) {
  const { grid, maxRequests, totalRequests, cacheRate, busiest } = useMemo(() => {
    const byCell = new Map<string, number>();
    let max = 0;
    let total = 0;

    cells.forEach((cell) => {
      const key = `${cell.weekday}-${cell.hour}`;
      const value = (byCell.get(key) ?? 0) + cell.requestCount;
      byCell.set(key, value);
      if (value > max) max = value;
      total += cell.requestCount;
    });

    const rows = WEEKDAY_LABELS.map((label, weekday) => ({
      label,
      weekday,
      groups: HOUR_GROUPS.map((group) => ({
        label: group.label,
        value: group.hours.reduce((sum, hour) => sum + (byCell.get(`${weekday}-${hour}`) ?? 0), 0),
      })),
    }));

    let busiestCell: { weekday: number; hour: number; value: number } | null = null;
    byCell.forEach((value, key) => {
      const [weekday, hour] = key.split("-").map(Number) as [number, number];
      if (!busiestCell || value > busiestCell.value) busiestCell = { weekday, hour, value };
    });

    let cacheTokens = 0;
    let inputTokens = 0;
    trend.forEach((point) => {
      cacheTokens += point.cacheTokens;
      inputTokens += point.inputTokens;
    });

    return {
      grid: rows,
      maxRequests: max,
      totalRequests: total,
      cacheRate: inputTokens > 0 ? getCacheRatio(inputTokens, cacheTokens) : null,
      busiest: busiestCell as { weekday: number; hour: number; value: number } | null,
    };
  }, [cells, trend]);

  if (cells.length === 0 || maxRequests <= 0) {
    return null;
  }

  // 平均 RPM 只在小时粒度下有意义：day 桶里的请求数除以 1440 会低估峰值。
  const windowMinutes = granularity === "hour" ? trend.length * 60 : null;
  const averageRpm = windowMinutes && windowMinutes > 0 ? totalRequests / windowMinutes : null;

  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <p className="ds-kicker">分布</p>
          <h2 className="mt-3 text-[1.16rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)] sm:text-[1.45rem]">
            用量热力图
          </h2>
          <p className="mt-2 text-[0.72rem] text-[var(--foreground-faint)]">按北京时间统计的星期 × 小时请求分布</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.76rem] text-[var(--foreground-soft)]">
          <span>
            平均 RPM{" "}
            <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">
              {averageRpm === null ? "-" : averageRpm.toFixed(1)}
            </span>
          </span>
          <span>
            峰值{" "}
            <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">
              {busiest ? formatCompactNumberStr(busiest.value) : "-"}
            </span>
            {busiest ? (
              <span className="ml-1 text-[var(--foreground-faint)]">
                {WEEKDAY_LABELS[busiest.weekday]} {String(busiest.hour).padStart(2, "0")}:00
              </span>
            ) : null}
          </span>
          <span>
            缓存命中率{" "}
            <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">
              {formatPercent(cacheRate)}
            </span>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="mb-1 grid grid-cols-[44px_repeat(8,minmax(0,1fr))] gap-1">
            <span />
            {HOUR_GROUPS.map((group) => (
              <span
                key={group.label}
                className="ds-mono text-center text-[0.62rem] font-semibold text-[var(--foreground-faint)]"
              >
                {group.label}
              </span>
            ))}
          </div>

          {grid.map((row) => (
            <div key={row.weekday} className="mb-1 grid grid-cols-[44px_repeat(8,minmax(0,1fr))] gap-1">
              <span className="flex items-center text-[0.68rem] text-[var(--foreground-soft)]">{row.label}</span>
              {row.groups.map((group) => {
                const intensity = maxRequests > 0 ? group.value / maxRequests : 0;
                return (
                  <div
                    key={group.label}
                    title={`${row.label} ${group.label}:00–${Number(group.label) + 3}:00 · ${group.value.toLocaleString("zh-CN")} 次请求`}
                    className="h-7 rounded-[6px] shadow-[0_0_0_1px_var(--surface-ring-soft)]"
                    style={{
                      backgroundColor:
                        group.value > 0
                          ? `color-mix(in srgb, var(--foreground) ${Math.max(6, Math.round(intensity * 55))}%, transparent)`
                          : "var(--background-muted)",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[0.68rem] text-[var(--foreground-faint)]">
        合计 {formatCompactNumberStr(totalRequests)} 次请求；颜色越深表示该时段请求越集中。
      </p>
    </section>
  );
}
