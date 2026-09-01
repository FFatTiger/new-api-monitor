"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatCompactNumber, formatCompactNumberStr, formatPercent } from "@/lib/format";
import type { ModelRankingRow } from "@/lib/queries/dashboard";

interface ModelTokenPieChartProps {
  rows: ModelRankingRow[];
}

interface SliceDatum {
  key: string;
  name: string;
  value: number;
  share: number;
  color: string;
}

const TOP_N = 8;

const SLICE_COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#64748b",
];

const subscribe = () => () => {};

function buildSlices(rows: ModelRankingRow[]): SliceDatum[] {
  const sorted = [...rows]
    .filter((row) => Number.isFinite(row.totalTokens) && row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  if (sorted.length === 0) {
    return [];
  }

  const total = sorted.reduce((sum, row) => sum + row.totalTokens, 0);
  if (total <= 0) {
    return [];
  }

  const head = sorted.slice(0, TOP_N);
  const tail = sorted.slice(TOP_N);
  const slices: SliceDatum[] = head.map((row, index) => ({
    key: row.modelName || `model-${index}`,
    name: row.modelName || "未知模型",
    value: row.totalTokens,
    share: row.totalTokens / total,
    color: SLICE_COLORS[index % SLICE_COLORS.length],
  }));

  if (tail.length > 0) {
    const otherValue = tail.reduce((sum, row) => sum + row.totalTokens, 0);
    if (otherValue > 0) {
      slices.push({
        key: "__other__",
        name: `其他 ${tail.length} 个模型`,
        value: otherValue,
        share: otherValue / total,
        color: SLICE_COLORS[SLICE_COLORS.length - 1],
      });
    }
  }

  return slices;
}

export function ModelTokenPieChart({ rows }: ModelTokenPieChartProps) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const slices = useMemo(() => buildSlices(rows), [rows]);
  const totalTokens = useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices]);

  if (slices.length === 0) {
    return null;
  }

  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <p className="ds-kicker">分布</p>
          <h2 className="mt-3 text-[1.16rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)] sm:text-[1.45rem]">
            模型 Token 消耗
          </h2>
        </div>
        <div className="text-right">
          <p className="ds-kicker text-[0.58rem] text-[var(--foreground-faint)]">总令牌</p>
          <p className="mt-1 ds-mono text-[1.05rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            {formatCompactNumber(totalTokens)}
          </p>
        </div>
      </div>

      {!mounted ? (
        <div className="grid h-72 place-items-center rounded-[18px] bg-[var(--background-muted)] text-sm text-[var(--foreground-soft)] shadow-[0_0_0_1px_var(--surface-ring-soft)]">
          图表加载中…
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] lg:items-center">
          <div className="relative h-72 min-w-0 rounded-[18px] bg-[var(--background-elevated)] p-2 shadow-[0_0_0_1px_var(--surface-ring-soft)] sm:h-80 sm:p-3">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={slices.length > 1 ? 1.5 : 0}
                  stroke="var(--background-elevated)"
                  strokeWidth={2}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.key} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, _name, item) => {
                    const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                    const payload = item?.payload as SliceDatum | undefined;
                    const shareLabel = payload ? formatPercent(payload.share) : "-";
                    return [`${formatCompactNumberStr(numericValue)} · ${shareLabel}`, "总令牌"];
                  }}
                  contentStyle={{
                    backgroundColor: "var(--tooltip-background)",
                    borderRadius: 16,
                    border: "none",
                    boxShadow:
                      "0px 0px 0px 1px rgba(0, 0, 0, 0.08), 0px 12px 40px -16px rgba(0, 0, 0, 0.18)",
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                  labelStyle={{ color: "var(--foreground-soft)", marginBottom: 4 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="ds-kicker text-[0.58rem] text-[var(--foreground-faint)]">模型数</p>
                <p className="mt-1 ds-mono text-[1.35rem] font-semibold tracking-[-0.06em] text-[var(--foreground)]">
                  {rows.filter((row) => row.totalTokens > 0).length}
                </p>
              </div>
            </div>
          </div>

          <ul className="space-y-2.5">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-start justify-between gap-3 text-[0.82rem]">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--foreground)]" title={slice.name}>
                      {slice.name}
                    </p>
                    <p className="mt-0.5 ds-mono text-[0.72rem] text-[var(--foreground-soft)]">
                      {formatCompactNumberStr(slice.value)}
                    </p>
                  </div>
                </div>
                <span className="ds-mono shrink-0 font-medium text-[var(--foreground)]">
                  {formatPercent(slice.share)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
