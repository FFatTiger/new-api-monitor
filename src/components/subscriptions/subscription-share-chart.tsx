"use client";

import { useMemo } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatPercent } from "@/lib/format";
import { computeUsageShare } from "@/lib/queries/subscription-stats";
import type { UserUsageRow } from "@/lib/queries/subscriptions";

interface SubscriptionShareChartProps {
  rows: UserUsageRow[];
}

const TOP_N = 10;

function userLabel(row: UserUsageRow): string {
  return row.username || (row.userId ? `#${row.userId}` : "未知");
}

export function SubscriptionShareChart({ rows }: SubscriptionShareChartProps) {
  const data = useMemo(() => {
    const totalUsed = Number(rows[0]?.totalUsedQuota ?? 0);
    if (!totalUsed) return [];

    const ranked = rows
      .map((r) => ({
        name: userLabel(r),
        share: computeUsageShare(r.amountUsed, totalUsed),
        used: Number(r.amountUsed) || 0,
      }))
      .sort((a, b) => b.used - a.used);

    const top = ranked.slice(0, TOP_N);
    const rest = ranked.slice(TOP_N);
    if (rest.length > 0) {
      const restShare = rest.reduce((s, r) => s + r.share, 0);
      const restUsed = rest.reduce((s, r) => s + r.used, 0);
      top.push({ name: `其他 (${rest.length})`, share: restShare, used: restUsed });
    }
    return top;
  }, [rows]);

  if (data.length === 0) {
    return null;
  }

  return (
    <section className="ds-card p-4 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
      <h2 className="mb-3 text-[0.9rem] font-medium text-[var(--foreground)]">消耗占比 Top {TOP_N}</h2>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis
              type="number"
              tickFormatter={(v) => formatPercent(typeof v === "number" ? v : Number(v ?? 0))}
              stroke="var(--foreground-soft)"
              fontSize={11}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              stroke="var(--foreground-soft)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value) => {
                const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                return [formatPercent(numericValue), "占比"];
              }}
              contentStyle={{
                background: "var(--background-elevated)",
                border: "1px solid var(--surface-ring)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="share" fill="#60a5fa" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
