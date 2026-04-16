"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompactNumber, formatInteger, formatTrendLabel } from "@/lib/format";
import type { TrendGranularity, TrendPoint } from "@/lib/queries/dashboard";

interface UsageTrendChartProps {
  data: TrendPoint[];
  granularity: TrendGranularity;
}

const subscribe = () => () => {};

export function UsageTrendChart({ data, granularity }: UsageTrendChartProps) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const chartData = useMemo(
    () =>
      data.map((point) => ({
        ...point,
        label: formatTrendLabel(point.bucketTs, granularity),
      })),
    [data, granularity],
  );

  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <p className="ds-kicker">趋势</p>
          <h2 className="mt-3 text-[1.16rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)] sm:text-[1.45rem]">
            令牌趋势
          </h2>
        </div>
        <span className="ds-pill px-3 py-2 ds-kicker text-[0.58rem] text-[var(--foreground-faint)]">
          {granularity === "hour" ? "小时" : "天"}
        </span>
      </div>

      {!mounted ? (
        <div className="grid h-60 place-items-center rounded-[18px] bg-[var(--background-muted)] text-sm text-[var(--foreground-soft)] shadow-[0_0_0_1px_var(--surface-ring-soft)] sm:h-72">
          趋势加载中…
        </div>
      ) : (
        <div className="h-60 min-w-0 rounded-[18px] bg-[var(--background-elevated)] p-2 shadow-[0_0_0_1px_var(--surface-ring-soft)] sm:h-72 sm:p-3">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <LineChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 6" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--foreground-faint)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={18}
              />
              <YAxis
                tick={{ fill: "var(--foreground-faint)", fontSize: 11 }}
                tickFormatter={formatCompactNumber}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                cursor={{ stroke: "var(--chart-cursor)", strokeWidth: 1 }}
                contentStyle={{
                  backgroundColor: "var(--tooltip-background)",
                  borderRadius: 16,
                  border: "none",
                  boxShadow:
                    "0px 0px 0px 1px rgba(0, 0, 0, 0.08), 0px 12px 40px -16px rgba(0, 0, 0, 0.18)",
                }}
                formatter={(value, name) => {
                  const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                  const seriesName = String(name ?? "");

                  if (seriesName === "requestCount") {
                    return [formatInteger(numericValue), "请求数"];
                  }

                  return [formatCompactNumber(numericValue), "令牌消耗"];
                }}
                labelFormatter={(label) => `时间 ${label}`}
              />
              <Line
                type="monotone"
                dataKey="totalTokens"
                stroke="var(--foreground)"
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 4, fill: "var(--chart-active-dot-fill)", stroke: "var(--foreground)", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
