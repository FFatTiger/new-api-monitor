# New-API 订阅数据展示页 设计文档

日期：2026-07-24
状态：待实现

## 1. 背景与目标

`new-api-monitor` 当前只有「监控概览」（token/用户/模型/渠道消耗排行）和「账号 Quota」（外部 provider 余额代理）两个数据视图。

new-api 生产库（`postgres` 容器，db=`new-api`）新增了完整的 **订阅体系**，目前没有任何页面展示。本次新增一个「订阅」页，用于查看：

1. 所有用户的订阅信息（套餐、额度、消耗、有效期、状态）
2. 全量订阅的消耗汇总
3. 每个用户订阅消耗占全部订阅已消耗总额的百分比（"我的额度 ÷ 所有人已消耗额度"）

## 2. 数据源（已核实）

直连项目现有 `DATABASE_URL`（new-api 主库）。只读查询，4 张订阅相关表：

- `subscription_plans`：套餐定义。关键字段 `id, title, price_amount, currency, total_amount, upgrade_group, enabled`
- `user_subscriptions`：用户订阅实例（核心）。字段 `id, user_id, plan_id, amount_total, amount_used, start_time, end_time, status, upgrade_group, source, last_reset_time, next_reset_time`
- `subscription_orders`：支付订单（本次**只读不计入展示**，预留）
- `subscription_pre_consume_records`：请求级预扣（本次不展示）
- `users`：关联用户名。字段 `id, username, display_name`

### 关键语义

- `amount_total` / `amount_used` 单位 = new-api quota 整数（非美元）。当前生产值：每订阅 `amount_total = 50000000000000`
- **美元换算**：new-api 默认 `QuotaPerUnit = 500000`，即 `USD = quota / 500000`（options 表未覆盖，用默认值）。显示时同时给出 quota 原值（title）和美元值。
- 时间戳为 Unix 秒（`start_time` / `end_time` / `created_at`）
- 当前生产规模：21 条订阅，全部 `status='active'`；2 个套餐 `pro20x` / `pro20x_cry`

### 占比口径（已与用户确认）

```
消耗占比% = 该订阅 amount_used / SUM(所有订阅 amount_used)
```

分子=该订阅已消耗额度，分母=全部订阅已消耗额度总和。**不是**按 `amount_total` 算。

## 3. 功能范围（MVP）

### 3.1 汇总卡片区（顶部）

复用 `ds-card` 样式，4 张卡片：

| 卡片 | 值 | 说明 |
|---|---|---|
| 订阅总数 | `COUNT(*)` | 含所有状态 |
| 活跃订阅 | `COUNT(*) FILTER (status='active')` | |
| 已消耗总额 | `SUM(amount_used)` | quota + 美元 |
| 订阅总额度 | `SUM(amount_total)` | quota + 美元 |

并在卡片下方放一条**整体消耗进度条**（已消耗/总额度），复用 `ProgressBar` 组件。

### 3.2 用户订阅表格（主体）

每行 = 一条 `user_subscriptions`，列：

1. 用户名（`users.username`，缺失显示 `用户 #{user_id}`）
2. 套餐（`subscription_plans.title`）
3. 升级组（`user_subscriptions.upgrade_group`，如 `gpt_pro` / `gpt_sub`）
4. 订阅总额度（`amount_total`，美元 + quota title）
5. 已消耗（`amount_used`，美元 + quota title）
6. 剩余（`amount_total - amount_used`）
7. **消耗占比%**（`amount_used / 全表 SUM(amount_used)`），用 `formatPercent`
8. 订阅进度（`amount_used / amount_total`，`ProgressBar`）
9. 有效期（`start_time` ~ `end_time`，`formatDateTime`），到期临近高亮
10. 状态（`status`）

**排序**：默认按 `amount_used` 降序（消耗最多的排最前）。
**状态筛选**：MVP 默认显示全部，active 优先；后续可加 tab 切换 active/expired（YAGNI，先不做）。

### 3.3 占比图表（可选，MVP 包含）

用项目已有的 `recharts` 画一个**横向条形图**，直观展示各用户 `amount_used` 占比。只取 Top 10 + "其他"聚合，避免 21 条全画。

## 4. 非目标（YAGNI）

- ❌ 历史消耗趋势曲线（需 `subscription_pre_consume_records` 聚合，额外成本）
- ❌ 订单/支付流水展示（`subscription_orders`）
- ❌ 套餐管理 CRUD
- ❌ 状态筛选 tab、时间范围筛选
- ❌ 分页（当前 21 条，全量渲染；>200 条再加）

## 5. 技术设计

### 5.1 架构

**Server Component 直查 DB**（仿 `src/app/page.tsx`），不走 client fetch。原因：数据量小（21 行）、无交互筛选、SSR 即可、与 dashboard 主页一致。

```
/subscriptions (RSC page)
  ├─ AppHeader (复用，subtitle="订阅额度与消耗占比")
  ├─ SubscriptionsSummary (RSC, 接收 summary 数据)
  ├─ SubscriptionShareChart (client, recharts)
  └─ SubscriptionsTable (RSC)
```

### 5.2 新增文件

| 文件 | 职责 |
|---|---|
| `src/lib/queries/subscriptions.ts` | 查询层：`getSubscriptionsOverview()` 返回 `{summary, rows}` |
| `src/app/subscriptions/page.tsx` | RSC 页面，调查询层，渲染 |
| `src/components/subscriptions/subscriptions-summary.tsx` | 汇总卡片 + 整体进度条 |
| `src/components/subscriptions/subscriptions-table.tsx` | 订阅表格 |
| `src/components/subscriptions/subscription-share-chart.tsx` | recharts 占比图（client） |

### 5.3 修改文件

| 文件 | 改动 |
|---|---|
| `src/components/navigation/top-tabs.tsx` | `tabs` 数组加 `{ href: "/subscriptions", label: "订阅" }`，插在「账号 Quota」之后 |

### 5.4 查询层设计 `src/lib/queries/subscriptions.ts`

```ts
import { query } from "@/lib/db";

export interface SubscriptionSummary {
  totalCount: number;
  activeCount: number;
  totalUsedQuota: string;   // bigint 以字符串返回，避免 JS number 精度丢失
  totalQuota: string;
}

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

export interface SubscriptionsOverview {
  summary: SubscriptionSummary;
  rows: SubscriptionRow[];
}
```

**单次查询**拿到行 + 用窗口函数同时算全局已消耗总额（避免两次往返）：

```sql
SELECT
  us.id,
  us.user_id,
  u.username,
  u.display_name,
  sp.title AS plan_title,
  COALESCE(NULLIF(us.upgrade_group, ''), 'default') AS upgrade_group,
  us.amount_total::text AS amount_total,
  us.amount_used::text AS amount_used,
  (us.amount_total - us.amount_used)::text AS amount_remaining,
  us.start_time,
  us.end_time,
  us.status,
  us.source,
  SUM(us.amount_used) OVER ()::text AS total_used_quota,   -- 全局分母
  COUNT(*) OVER () AS total_count,
  COUNT(*) FILTER (WHERE us.status = 'active') OVER () AS active_count,
  SUM(us.amount_total) OVER ()::text AS total_quota
FROM user_subscriptions us
LEFT JOIN users u ON u.id = us.user_id
LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
ORDER BY us.amount_used DESC;
```

> 注：`amount_total/amount_used` 是 `bigint`，JS Number 最大安全整数约 9e15，当前值 5e13 在安全范围内，但仍统一 `::text` 返回并在前端 `BigInt`/`Number` 解析，避免未来溢出。占比计算用 `Number(amountUsed) / Number(totalUsed)`。

summary 的 `totalCount/activeCount/totalUsedQuota/totalQuota` 直接取第一行的窗口函数结果。

### 5.5 美元格式化（新增小工具）

在 `src/lib/format.tsx` 新增（或放查询层常量）：

```ts
export const QUOTA_PER_UNIT = 500000;
export function quotaToUsd(quota: number | string): number {
  return Number(quota) / QUOTA_PER_UNIT;
}
export function formatUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

### 5.6 Next.js 16 注意事项

按 `AGENTS.md`，写代码前需读 `node_modules/next/dist/docs/` 相关章节（RSC、route、metadata）。本次主要是 RSC page + 现有 `dynamic = "force-dynamic"`，模式已在 `page.tsx` / `quota/page.tsx` 验证过，沿用即可。

## 6. 数据正确性验证

实现后用生产库对照核验（只读）：

```sql
-- 核对汇总
SELECT COUNT(*), COUNT(*) FILTER (WHERE status='active'),
       SUM(amount_used), SUM(amount_total) FROM user_subscriptions;
-- 核对 Top1 占比
SELECT username, amount_used,
       amount_used::float / SUM(amount_used) OVER () AS share
FROM user_subscriptions us JOIN users u ON u.id=us.user_id
ORDER BY amount_used DESC LIMIT 1;
```

前端展示的汇总值、占比必须与上述 SQL 结果一致。

## 7. 测试

- 查询层加 `src/lib/queries/subscriptions.test.ts`：用固定输入验证占比、剩余、汇总计算（纯函数拆出 `computeSubscriptionStats(rows)`）。
- 复用 `npm run test:dashboard` 模式跑（node --test）。
- 无需 DB 集成测试（沿用项目现有约定，不连真实库）。

## 8. 安全

- 只读查询，无写入。
- 不暴露 `user_id` 等敏感字段到 URL；表格展示 `username`（内网工具，与现有 dashboard 一致）。
- 无新增 env 变量（复用 `DATABASE_URL`）。
