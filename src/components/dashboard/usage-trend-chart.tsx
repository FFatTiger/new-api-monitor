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
import type { TrendPoint, TrendGranularity } from "@/lib/queries/dashboard";

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
    <section className="rounded-[1.25rem] border border-[#273140] bg-[linear-gradient(180deg,rgba(6,10,15,0.98),rgba(8,13,20,0.98))] p-3 shadow-[0_32px_120px_rgba(0,0,0,0.34)] sm:rounded-[1.65rem] sm:p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/6 pb-3">
        <div>
          <p className="text-[0.58rem] uppercase tracking-[0.22em] text-slate-500 sm:text-[0.62rem] sm:tracking-[0.32em]">趋势行</p>
          <h2 className="mt-1 [font-family:var(--font-code)] text-[0.92rem] font-semibold uppercase tracking-[0.18em] text-white sm:text-[1.02rem] sm:tracking-[0.24em]">
            令牌趋势
          </h2>
        </div>
        <span className="rounded-[0.85rem] border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.6rem] uppercase tracking-[0.16em] text-slate-400 sm:rounded-[0.9rem] sm:text-[0.64rem] sm:tracking-[0.22em]">
          {granularity === "hour" ? "小时" : "天"}
        </span>
      </div>

      {!mounted ? (
        <div className="grid h-60 place-items-center rounded-[0.95rem] border border-white/8 bg-white/[0.03] text-sm text-slate-500 sm:h-72 sm:rounded-[1rem]">
          趋势加载中…
        </div>
      ) : (
        <div className="h-60 min-w-0 rounded-[0.95rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-2 sm:h-72 sm:rounded-[1rem] sm:p-3">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <LineChart data={chartData} margin={{ top: 12, right: 6, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="tokenFlowStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#7dd3fc" />
                  <stop offset="100%" stopColor="#f5b86b" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.14)" strokeDasharray="3 5" vertical />
              <XAxis
                dataKey="label"
                tick={{ fill: "#7f8ea3", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={18}
              />
              <YAxis
                tick={{ fill: "#7f8ea3", fontSize: 10 }}
                tickFormatter={formatCompactNumber}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                cursor={{ stroke: "rgba(125,211,252,0.28)", strokeWidth: 1 }}
                contentStyle={{
                  backgroundColor: "#05080d",
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.14)",
                  boxShadow: "0 18px 50px rgba(0, 0, 0, 0.45)",
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
                stroke="url(#tokenFlowStroke)"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4, fill: "#f5b86b", stroke: "#020617", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
