import type { SubscriptionBillingFilters } from "./subscription-billing-filters.ts";

export interface SubscriptionSummary {
  totalCount: number; // 当前数据库中的订阅条数
  activeCount: number; // 当前数据库中的活跃订阅条数
  totalUsedQuota: string; // 所选时间范围内的订阅计费日志 quota 总额
}

export interface UserUsageRow {
  userId: number | null;
  username: string | null;
  displayName: string | null;
  amountUsed: string; // 该用户在所选时间范围内的订阅计费日志 quota 合计
  totalUsedQuota: string; // 所选时间范围全局订阅消费总额（占比分母）
}

export interface SubscriptionsOverview {
  summary: SubscriptionSummary;
  rows: UserUsageRow[];
  generatedAt: number; // 查询完成时的服务端 Unix 秒
}

import { query } from "../db.ts";
import { computeUsageShare } from "./subscription-stats.ts";

export { computeUsageShare };

interface UserUsageDbRow extends Record<string, string | number | boolean | null> {
  has_usage: boolean;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  amount_used: string;
  total_used_quota: string;
  total_count: number;
  active_count: number;
}

export interface SubscriptionBillingQueryPlan {
  sql: string;
  values: number[];
}

export function buildSubscriptionsQuery(
  filters: SubscriptionBillingFilters,
): SubscriptionBillingQueryPlan {
  const values: number[] = [];
  const timeClauses: string[] = [];

  if (filters.startTimestamp !== null) {
    values.push(filters.startTimestamp);
    timeClauses.push(`AND l.created_at >= $${values.length}`);
  }

  if (filters.endTimestamp !== null) {
    values.push(filters.endTimestamp);
    timeClauses.push(`AND l.created_at <= $${values.length}`);
  }

  const sql = `
WITH subscription_logs AS MATERIALIZED (
  SELECT
    l.user_id,
    l.quota
  FROM logs l
  WHERE l.type = 2
    ${timeClauses.join("\n    ")}
    AND l.other LIKE '{%'
    AND l.other ~ '"billing_source"[[:space:]]*:[[:space:]]*"subscription"'
    -- Async task billing is excluded until its logs reliably carry subscription billing attribution.
),
log_users AS (
  SELECT
    sl.user_id,
    COALESCE(SUM(sl.quota), 0) AS amount_used
  FROM subscription_logs sl
  GROUP BY sl.user_id
),
subscription_summary AS (
  SELECT
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE status = 'active') AS active_count
  FROM user_subscriptions
),
billing_total AS (
  SELECT COALESCE(SUM(quota), 0) AS total_used_quota
  FROM subscription_logs
)
SELECT
  (lu.amount_used IS NOT NULL) AS has_usage,
  lu.user_id,
  u.username,
  u.display_name,
  COALESCE(lu.amount_used, 0)::text AS amount_used,
  bt.total_used_quota::text AS total_used_quota,
  ss.total_count,
  ss.active_count
FROM billing_total bt
CROSS JOIN subscription_summary ss
LEFT JOIN log_users lu ON TRUE
LEFT JOIN users u ON u.id = lu.user_id
ORDER BY lu.amount_used DESC NULLS LAST
`;

  return { sql, values };
}

export async function getSubscriptionsOverview(
  filters: SubscriptionBillingFilters,
): Promise<SubscriptionsOverview> {
  const plan = buildSubscriptionsQuery(filters);
  const result = await query<UserUsageDbRow>(plan.sql, plan.values);

  const rows: UserUsageRow[] = result.rows.filter((r) => r.has_usage).map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    amountUsed: r.amount_used,
    totalUsedQuota: r.total_used_quota,
  }));

  const first = result.rows[0];
  const summary: SubscriptionSummary = {
    totalCount: first ? Number(first.total_count) : 0,
    activeCount: first ? Number(first.active_count) : 0,
    totalUsedQuota: first ? first.total_used_quota : "0",
  };

  return { summary, rows, generatedAt: Math.floor(Date.now() / 1000) };
}
