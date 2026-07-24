# 订阅数据展示页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 new-api-monitor 新增 `/subscriptions` 页，展示所有用户订阅信息、全量消耗汇总、每个订阅消耗占全部已消耗总额的百分比。

**Architecture:** Next.js 16 RSC page 直查 PostgreSQL（new-api 主库，复用 `DATABASE_URL`），单条 SQL 用窗口函数同时取行数据与全局汇总。Server Component 渲染汇总卡 + 表格，唯一 client 组件是 recharts 占比图。沿用现有 `@/lib/db` query、`@/lib/format` 格式化、`ProgressBar`、`AppHeader`、`ds-card` 样式。

**Tech Stack:** Next.js 16.2.6 (App Router, RSC), React 19, TypeScript, pg, recharts 3, Tailwind 4。

**Spec:** `docs/superpowers/specs/2026-07-24-subscriptions-page-design.md`

## Global Constraints

- 复用现有 `DATABASE_URL`（new-api 主库，容器内 `postgres:5432/new-api`），**只读**查询，无写入。
- new-api quota 是 bigint；统一 `::text` 返回，前端用 `Number()` 解析（当前最大值 5e13 < Number.MAX_SAFE_INTEGER 9e15，安全）。
- **美元换算系数** `QUOTA_PER_UNIT = 500000`（new-api 默认，options 表未覆盖）。
- **占比口径**：`该订阅 amount_used / SUM(所有订阅 amount_used)`（分子=已消耗，非总额度）。
- 时间戳为 Unix **秒**（`start_time/end_time`），复用 `formatDateTime(ts)`（内部 ×1000）。
- 复用现有格式：`formatPercent`、`formatCompactNumber`、`formatDateTime` 来自 `@/lib/format`（实为 `src/lib/format.tsx`）。
- 复用样式原语：`ds-card`、`ds-pill`、`var(--foreground)` / `var(--foreground-soft)` / `var(--background-elevated)` / `var(--surface-ring)`。
- 复用 `ProgressBar` 组件：`src/components/quota/progress-bar.tsx`，props `{ percent, colorClass?, label?, valueLabel?, resetTime? }`。
- 复用 `AppHeader`：`src/components/navigation/app-header.tsx`，props `{ timestamp?, controls?, title?, subtitle? }`。
- Next.js 16 RSC page 顶部需 `export const dynamic = "force-dynamic";`（防静态渲染缓存 DB 结果）。
- 测试用 node --test（TS via `--experimental-strip-types`），跑 `npm run test:dashboard` 模式；**不连真实库**，纯函数测试。

---

## 文件结构

**新增：**
| 文件 | 职责 |
|---|---|
| `src/lib/queries/subscriptions.ts` | 查询层 + 纯函数 `computeSubscriptionStats` |
| `src/lib/queries/subscriptions.test.ts` | 纯函数单测 |
| `src/app/subscriptions/page.tsx` | RSC 页面 |
| `src/components/subscriptions/subscriptions-summary.tsx` | 汇总卡 + 整体进度条（RSC） |
| `src/components/subscriptions/subscriptions-table.tsx` | 订阅表格（RSC） |
| `src/components/subscriptions/subscription-share-chart.tsx` | recharts 占比条形图（client） |

**修改：**
| 文件 | 改动 |
|---|---|
| `src/components/navigation/top-tabs.tsx` | `tabs` 数组加「订阅」入口 |
| `src/lib/format.tsx` | 新增 `QUOTA_PER_UNIT` / `quotaToUsd` / `formatUsd` |

---

### Task 1: 格式化工具 — quota 美元换算

**Files:**
- Modify: `src/lib/format.tsx`（末尾追加）
- Test: `src/lib/format.tsx` 自身无单测；纯函数极简，跟随 Task 2 一起验证。本任务不单独写测试（避免对 JSX 导出函数做 node --test）。

**Interfaces:**
- Produces: `QUOTA_PER_UNIT`（const number=500000）、`quotaToUsd(quota: number|string): number`、`formatUsd(usd: number): string`

- [ ] **Step 1: 在 `src/lib/format.tsx` 末尾追加**

```ts
// new-api quota 美元换算（QuotaPerUnit 默认 500000，options 表未覆盖）
export const QUOTA_PER_UNIT = 500000;

export function quotaToUsd(quota: number | string): number {
  const n = typeof quota === "string" ? Number(quota) : quota;
  if (!Number.isFinite(n)) return 0;
  return n / QUOTA_PER_UNIT;
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "-";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add src/lib/format.tsx
git commit -m "feat(format): add quota-to-usd conversion helpers"
```

---

### Task 2: 查询层 — `getSubscriptionsOverview` + 纯函数 `computeSubscriptionStats`

**Files:**
- Create: `src/lib/queries/subscriptions.ts`
- Test: `src/lib/queries/subscriptions.test.ts`

**Interfaces:**
- Produces:
  - `SubscriptionRow`（见下，字段全 `string` 的 quota 用 string）
  - `SubscriptionSummary`：`{ totalCount, activeCount, totalUsedQuota, totalQuota }`（quota 为 string）
  - `SubscriptionsOverview`：`{ summary, rows }`
  - `getSubscriptionsOverview(): Promise<SubscriptionsOverview>` — 查 DB
  - `computeSubscriptionStats(rows): { totalUsed, totalQuota }` — 纯函数，供单测 + 占比分母复用
- Consumes: `query` from `@/lib/db`

- [ ] **Step 1: 写失败测试 `src/lib/queries/subscriptions.test.ts`**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeSubscriptionStats, computeUsageShare } from "./subscriptions.ts";

describe("computeSubscriptionStats", () => {
  it("sums amount_used and amount_total across rows", () => {
    const rows = [
      { amountUsed: "100", amountTotal: "1000" },
      { amountUsed: "300", amountTotal: "2000" },
    ] as const;
    assert.deepEqual(computeSubscriptionStats([...rows]), { totalUsed: 400, totalQuota: 3000 });
  });

  it("handles empty rows", () => {
    assert.deepEqual(computeSubscriptionStats([]), { totalUsed: 0, totalQuota: 0 });
  });

  it("treats non-numeric quota as 0", () => {
    const rows = [{ amountUsed: "abc", amountTotal: "" }] as const;
    assert.deepEqual(computeSubscriptionStats([...rows]), { totalUsed: 0, totalQuota: 0 });
  });
});

describe("computeUsageShare", () => {
  it("returns amount_used over total_used as a 0..1 fraction", () => {
    assert.equal(computeUsageShare("250", 1000), 0.25);
  });

  it("returns 0 when total is 0 to avoid divide-by-zero", () => {
    assert.equal(computeUsageShare("100", 0), 0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types --test src/lib/queries/subscriptions.test.ts`
Expected: FAIL（模块不存在 / 函数未导出）。

- [ ] **Step 3: 写实现 `src/lib/queries/subscriptions.ts`**

```ts
import { query } from "@/lib/db";

export interface SubscriptionRow {
  id: number;
  userId: number | null;
  username: string | null;
  displayName: string | null;
  planTitle: string | null;
  upgradeGroup: string;
  amountTotal: string;
  amountUsed: string;
  amountRemaining: string;
  startTime: number | null;
  endTime: number | null;
  status: string | null;
  source: string | null;
}

export interface SubscriptionSummary {
  totalCount: number;
  activeCount: number;
  totalUsedQuota: string;
  totalQuota: string;
}

export interface SubscriptionsOverview {
  summary: SubscriptionSummary;
  rows: SubscriptionRow[];
}

/** 纯函数：对已取回的行汇总（供单测 + 占比分母复用）。 */
export function computeSubscriptionStats(
  rows: ReadonlyArray<Pick<SubscriptionRow, "amountUsed" | "amountTotal">>,
): { totalUsed: number; totalQuota: number } {
  let totalUsed = 0;
  let totalQuota = 0;
  for (const r of rows) {
    const used = Number(r.amountUsed);
    const total = Number(r.amountTotal);
    if (Number.isFinite(used)) totalUsed += used;
    if (Number.isFinite(total)) totalQuota += total;
  }
  return { totalUsed, totalQuota };
}

/** 纯函数：单个订阅消耗占比（0..1），total=0 时返回 0。 */
export function computeUsageShare(amountUsed: string, totalUsed: number): number {
  if (!totalUsed) return 0;
  const used = Number(amountUsed);
  if (!Number.isFinite(used)) return 0;
  return used / totalUsed;
}

interface SubscriptionDbRow extends Record<string, string | number | null> {
  id: number;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  plan_title: string | null;
  upgrade_group: string;
  amount_total: string;
  amount_used: string;
  amount_remaining: string;
  start_time: number | null;
  end_time: number | null;
  status: string | null;
  source: string | null;
  total_used_quota: string;
  total_quota: string;
  total_count: number;
  active_count: number;
}

const SQL = `
SELECT
  us.id,
  us.user_id,
  u.username,
  u.display_name,
  sp.title AS plan_title,
  COALESCE(NULLIF(us.upgrade_group, ''), 'default') AS upgrade_group,
  us.amount_total::text  AS amount_total,
  us.amount_used::text   AS amount_used,
  (us.amount_total - us.amount_used)::text AS amount_remaining,
  us.start_time,
  us.end_time,
  us.status,
  us.source,
  SUM(us.amount_used) OVER ()::text    AS total_used_quota,
  SUM(us.amount_total) OVER ()::text   AS total_quota,
  COUNT(*) OVER ()                     AS total_count,
  COUNT(*) FILTER (WHERE us.status = 'active') OVER () AS active_count
FROM user_subscriptions us
LEFT JOIN users u ON u.id = us.user_id
LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
ORDER BY us.amount_used DESC
`;

export async function getSubscriptionsOverview(): Promise<SubscriptionsOverview> {
  const result = await query<SubscriptionDbRow>(SQL);

  const rows: SubscriptionRow[] = result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    planTitle: r.plan_title,
    upgradeGroup: r.upgrade_group,
    amountTotal: r.amount_total,
    amountUsed: r.amount_used,
    amountRemaining: r.amount_remaining,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status,
    source: r.source,
  }));

  const first = result.rows[0];
  const summary: SubscriptionSummary = {
    totalCount: first ? Number(first.total_count) : 0,
    activeCount: first ? Number(first.active_count) : 0,
    totalUsedQuota: first ? first.total_used_quota : "0",
    totalQuota: first ? first.total_quota : "0",
  };

  return { summary, rows };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types --test src/lib/queries/subscriptions.test.ts`
Expected: 5 tests PASS。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/subscriptions.ts src/lib/queries/subscriptions.test.ts
git commit -m "feat(queries): add subscriptions overview query + stat helpers"
```

---

### Task 3: 顶部导航 Tab

**Files:**
- Modify: `src/components/navigation/top-tabs.tsx`（`tabs` 数组）

**Interfaces:**
- Produces: 顶部 Tab 出现「订阅」入口，路径 `/subscriptions`
- Consumes: 无

- [ ] **Step 1: 修改 `tabs` 数组**

把 `src/components/navigation/top-tabs.tsx` 顶部的：

```ts
const tabs = [
  { href: "/", label: "监控概览" },
  { href: "/quota", label: "账号 Quota" },
  { href: "/oauth", label: "OAuth 登录" },
];
```

改为：

```ts
const tabs = [
  { href: "/", label: "监控概览" },
  { href: "/quota", label: "账号 Quota" },
  { href: "/subscriptions", label: "订阅" },
  { href: "/oauth", label: "OAuth 登录" },
];
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/navigation/top-tabs.tsx
git commit -m "feat(nav): add subscriptions tab"
```

---

### Task 4: 汇总卡组件 `SubscriptionsSummary`

**Files:**
- Create: `src/components/subscriptions/subscriptions-summary.tsx`

**Interfaces:**
- Consumes: `SubscriptionSummary` from `@/lib/queries/subscriptions`、`quotaToUsd`/`formatUsd` from `@/lib/format`、`ProgressBar` from `@/components/quota/progress-bar`
- Produces: `SubscriptionsSummary` 组件，props `{ summary: SubscriptionSummary }`

- [ ] **Step 1: 写组件**

```tsx
import { ProgressBar } from "@/components/quota/progress-bar";
import { formatUsd, quotaToUsd } from "@/lib/format";
import type { SubscriptionSummary } from "@/lib/queries/subscriptions";

interface SubscriptionsSummaryProps {
  summary: SubscriptionSummary;
}

export function SubscriptionsSummary({ summary }: SubscriptionsSummaryProps) {
  const totalUsed = Number(summary.totalUsedQuota) || 0;
  const totalQuota = Number(summary.totalQuota) || 0;
  const overallPercent = totalQuota > 0 ? (totalUsed / totalQuota) * 100 : 0;

  const cards = [
    { label: "订阅总数", value: String(summary.totalCount), foot: "条" },
    { label: "活跃订阅", value: String(summary.activeCount), foot: "条" },
    { label: "已消耗总额", value: formatUsd(quotaToUsd(totalUsed)), foot: summary.totalUsedQuota, isQuota: true },
    { label: "订阅总额度", value: formatUsd(quotaToUsd(totalQuota)), foot: summary.totalQuota, isQuota: true },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="ds-card space-y-1.5 px-4 py-3 shadow-[0_0_0_1px_var(--surface-ring-soft)]"
          >
            <p className="text-[0.72rem] text-[var(--foreground-soft)]">{c.label}</p>
            <p className="ds-mono text-[1.05rem] font-semibold text-[var(--foreground)]">{c.value}</p>
            {c.isQuota ? (
              <p className="ds-mono text-[0.66rem] text-[var(--foreground-muted)]" title={`quota ${c.foot}`}>
                quota {Number(c.foot).toLocaleString("en-US")}
              </p>
            ) : (
              <p className="text-[0.66rem] text-[var(--foreground-muted)]">{c.foot}</p>
            )}
          </div>
        ))}
      </div>

      <div className="ds-card px-4 py-3 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
        <ProgressBar
          percent={overallPercent}
          label="整体消耗进度（已消耗 / 订阅总额度）"
          valueLabel={`${overallPercent.toFixed(1)}%`}
          colorClass="bg-blue-400/80"
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/subscriptions/subscriptions-summary.tsx
git commit -m "feat(subscriptions): add summary cards + overall progress"
```

---

### Task 5: 订阅表格组件 `SubscriptionsTable`

**Files:**
- Create: `src/components/subscriptions/subscriptions-table.tsx`

**Interfaces:**
- Consumes: `SubscriptionRow` + `computeSubscriptionStats` + `computeUsageShare` from `@/lib/queries/subscriptions`、`formatPercent`/`formatDateTime`/`quotaToUsd`/`formatUsd` from `@/lib/format`、`ProgressBar` + `getProgressTone` from `@/components/quota/progress-bar`
- Produces: `SubscriptionsTable` 组件，props `{ rows: SubscriptionRow[] }`

- [ ] **Step 1: 写组件**

```tsx
import { ProgressBar, getProgressTone } from "@/components/quota/progress-bar";
import { formatDateTime, formatPercent, formatUsd, quotaToUsd } from "@/lib/format";
import {
  computeSubscriptionStats,
  computeUsageShare,
  type SubscriptionRow,
} from "@/lib/queries/subscriptions";

interface SubscriptionsTableProps {
  rows: SubscriptionRow[];
}

function userLabel(row: SubscriptionRow): string {
  return row.username || (row.userId ? `用户 #${row.userId}` : "未知用户");
}

function quotaCell(quota: string): { usd: string; title: string } {
  const n = Number(quota);
  return {
    usd: formatUsd(quotaToUsd(n)),
    title: Number.isFinite(n) ? n.toLocaleString("en-US") : quota,
  };
}

export function SubscriptionsTable({ rows }: SubscriptionsTableProps) {
  const { totalUsed } = computeSubscriptionStats(rows);
  const now = Math.floor(Date.now() / 1000);

  return (
    <section className="ds-card overflow-hidden shadow-[0_0_0_1px_var(--surface-ring-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.8rem]">
          <thead>
            <tr className="border-b border-[var(--surface-divider)] bg-[var(--background-muted)] text-left text-[var(--foreground-soft)]">
              <th className="px-3 py-2.5 font-medium">用户</th>
              <th className="px-3 py-2.5 font-medium">套餐</th>
              <th className="px-3 py-2.5 font-medium">升级组</th>
              <th className="px-3 py-2.5 text-right font-medium">订阅额度</th>
              <th className="px-3 py-2.5 text-right font-medium">已消耗</th>
              <th className="px-3 py-2.5 text-right font-medium">剩余</th>
              <th className="px-3 py-2.5 text-right font-medium">消耗占比</th>
              <th className="px-3 py-2.5 font-medium">订阅进度</th>
              <th className="px-3 py-2.5 font-medium">有效期</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const totalCell = quotaCell(row.amountTotal);
              const usedCell = quotaCell(row.amountUsed);
              const remainCell = quotaCell(row.amountRemaining);
              const share = computeUsageShare(row.amountUsed, totalUsed);
              const subPercent = Number(row.amountTotal) > 0
                ? (Number(row.amountUsed) / Number(row.amountTotal)) * 100
                : 0;
              const endingSoon = row.endTime ? row.endTime - now < 3 * 24 * 3600 : false;

              return (
                <tr key={row.id} className="border-b border-[var(--surface-divider-soft)] last:border-0">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-[var(--foreground)]">{userLabel(row)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--foreground-soft)]">{row.planTitle || "-"}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-[var(--background-muted)] px-2 py-0.5 text-[0.7rem] text-[var(--foreground-soft)]">
                      {row.upgradeGroup}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono" title={`quota ${totalCell.title}`}>
                    {totalCell.usd}
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono font-medium" title={`quota ${usedCell.title}`}>
                    {usedCell.usd}
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono text-[var(--foreground-soft)]" title={`quota ${remainCell.title}`}>
                    {remainCell.usd}
                  </td>
                  <td className="px-3 py-2.5 text-right ds-mono font-medium">{formatPercent(share)}</td>
                  <td className="px-3 py-2.5 min-w-[8rem]">
                    <ProgressBar
                      percent={subPercent}
                      colorClass={getProgressTone(subPercent / 100)}
                      valueLabel={`${subPercent.toFixed(1)}%`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-[var(--foreground-soft)]">
                    <span className={endingSoon ? "text-red-500" : ""}>
                      {row.startTime ? formatDateTime(row.startTime) : "-"} ~ {row.endTime ? formatDateTime(row.endTime) : "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-[0.7rem]",
                        row.status === "active"
                          ? "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-[var(--background-muted)] text-[var(--foreground-soft)]",
                      ].join(" ")}
                    >
                      {row.status || "-"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-[var(--foreground-soft)]">
                  暂无订阅数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/subscriptions/subscriptions-table.tsx
git commit -m "feat(subscriptions): add subscriptions table with usage share"
```

---

### Task 6: 占比图表 `SubscriptionShareChart`（client）

**Files:**
- Create: `src/components/subscriptions/subscription-share-chart.tsx`

**Interfaces:**
- Consumes: `SubscriptionRow` + `computeSubscriptionStats` + `computeUsageShare` from `@/lib/queries/subscriptions`、`formatPercent` from `@/lib/format`、recharts
- Produces: `SubscriptionShareChart` 组件（`"use client"`），props `{ rows: SubscriptionRow[] }`

- [ ] **Step 1: 写组件**

```tsx
"use client";

import { useMemo } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatPercent } from "@/lib/format";
import {
  computeSubscriptionStats,
  computeUsageShare,
  type SubscriptionRow,
} from "@/lib/queries/subscriptions";

interface SubscriptionShareChartProps {
  rows: SubscriptionRow[];
}

const TOP_N = 10;

function userLabel(row: SubscriptionRow): string {
  return row.username || (row.userId ? `#${row.userId}` : "未知");
}

export function SubscriptionShareChart({ rows }: SubscriptionShareChartProps) {
  const data = useMemo(() => {
    const { totalUsed } = computeSubscriptionStats(rows);
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
            <XAxis type="number" tickFormatter={(v) => formatPercent(v as number)} stroke="var(--foreground-soft)" fontSize={11} />
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
              formatter={(value: number) => [formatPercent(value), "占比"]}
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
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/subscriptions/subscription-share-chart.tsx
git commit -m "feat(subscriptions): add usage share bar chart"
```

---

### Task 7: 页面组装 `src/app/subscriptions/page.tsx`

**Files:**
- Create: `src/app/subscriptions/page.tsx`

**Interfaces:**
- Consumes: `getSubscriptionsOverview` from `@/lib/queries/subscriptions`、`AppHeader`、三个子组件、`formatDateTime` from `@/lib/format`
- Produces: `/subscriptions` 路由页面

- [ ] **Step 1: 写页面**

```tsx
import { AppHeader } from "@/components/navigation/app-header";
import { SubscriptionShareChart } from "@/components/subscriptions/subscription-share-chart";
import { SubscriptionsSummary } from "@/components/subscriptions/subscriptions-summary";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { formatDateTime } from "@/lib/format";
import { getSubscriptionsOverview } from "@/lib/queries/subscriptions";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const { summary, rows } = await getSubscriptionsOverview();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AppHeader
        timestamp={formatDateTime(Math.floor(Date.now() / 1000))}
        subtitle="查看所有用户订阅额度与消耗占比。"
      />

      <SubscriptionsSummary summary={summary} />

      <SubscriptionShareChart rows={rows} />

      <SubscriptionsTable rows={rows} />
    </main>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 无错误。

- [ ] **Step 4: 生产构建（验证 RSC 编译通过）**

Run: `npm run build`
Expected: 构建成功，`/subscriptions` 路由出现在路由清单中。

- [ ] **Step 5: Commit**

```bash
git add src/app/subscriptions/page.tsx
git commit -m "feat(subscriptions): add /subscriptions page"
```

---

### Task 8: 数据正确性核验（手动，对生产库）

**Files:** 无（只读验证）

- [ ] **Step 1: 在生产库跑对照 SQL**

Run（SSH 到 ubuntu，进 postgres 容器）:
```bash
ssh proxxy@192.168.31.69 'docker exec postgres psql -U root -d new-api -c "SELECT COUNT(*), COUNT(*) FILTER (WHERE status=\"active\") active, SUM(amount_used) used, SUM(amount_total) total FROM user_subscriptions;"'
```
Expected: `count=21, active=21`，used/total 与页面汇总卡一致。

- [ ] **Step 2: 核对 Top1 占比**

Run:
```bash
ssh proxxy@192.168.31.69 'docker exec postgres psql -U root -d new-api -c "SELECT u.username, us.amount_used, (us.amount_used::float / SUM(us.amount_used) OVER ()) share FROM user_subscriptions us JOIN users u ON u.id=us.user_id ORDER BY us.amount_used DESC LIMIT 1;"'
```
Expected: `proxxy`，share 与页面表格首行「消耗占比」一致。

- [ ] **Step 3: 本地起 dev，浏览器打开 `/subscriptions` 视觉确认**

Run: `npm run dev`，访问 `http://localhost:31891/subscriptions`
Expected: Tab「订阅」高亮；4 张汇总卡显示美元 + quota；占比条形图渲染；表格 21 行按已消耗降序，首行 proxxy。

> 若本地 `.env.local` 的 `DATABASE_URL` 指向的库无订阅数据，跳过视觉确认，仅以 Step 1-2 的 SQL 对照作为正确性证据（部署到生产后再看页面）。

---

## Self-Review 结果

**1. Spec 覆盖：**
- ✅ 汇总卡（订阅总数/活跃/已消耗总额/订阅总额度）→ Task 4
- ✅ 整体消耗进度条 → Task 4
- ✅ 用户订阅表格（用户名/套餐/升级组/总额度/已消耗/剩余/消耗占比/订阅进度/有效期/状态）→ Task 5
- ✅ 占比图表（Top10 + 其他）→ Task 6
- ✅ 按 amount_used 降序 → Task 2 SQL `ORDER BY us.amount_used DESC`
- ✅ 占比口径 amount_used / SUM(amount_used) → Task 2 `computeUsageShare`
- ✅ 顶部 Tab → Task 3
- ✅ 美元换算 QUOTA_PER_UNIT=500000 → Task 1
- ✅ RSC 直查 DB + force-dynamic → Task 7
- ✅ 纯函数单测 → Task 2
- ✅ 数据正确性核验 → Task 8

**2. 占位符扫描：** 无 TBD/TODO，每个代码 step 都有完整代码。

**3. 类型一致性：** `SubscriptionRow`/`SubscriptionSummary` 在 Task 2 定义，Task 4/5/6/7 引用字段名一致（`amountUsed`/`amountTotal`/`amountRemaining`/`username`/`planTitle`/`upgradeGroup`/`status`/`startTime`/`endTime`/`userId`/`id`）。`computeSubscriptionStats`/`computeUsageShare` 签名在 Task 2 定义，Task 5/6 调用一致。
