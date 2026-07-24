export interface SubscriptionSummary {
  totalCount: number; // 订阅条数
  activeCount: number; // 活跃订阅条数
  totalUsedQuota: string; // 所有用户已消耗总额
}

export interface UserUsageRow {
  userId: number | null;
  username: string | null;
  displayName: string | null;
  amountUsed: string; // 该用户所有订阅已消耗合计
  amountTotal: string; // 该用户所有订阅总额度合计
  subscriptionCount: number; // 该用户的订阅条数
  plans: string; // 套餐标题（逗号分隔去重）
  upgradeGroups: string; // 升级组（逗号分隔去重）
  earliestEnd: number | null; // 最早到期时间
  latestEnd: number | null; // 最晚到期时间
  totalUsedQuota: string; // 全局已消耗总额（占比分母）
}

export interface SubscriptionsOverview {
  summary: SubscriptionSummary;
  rows: UserUsageRow[];
  generatedAt: number; // 查询完成时的服务端 Unix 秒
}

import { query } from "../db.ts";
import { computeUsageShare } from "./subscription-stats.ts";

export { computeUsageShare };

interface UserUsageDbRow extends Record<string, string | number | null> {
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  amount_used: string;
  amount_total: string;
  subscription_count: number;
  plans: string | null;
  upgrade_groups: string | null;
  earliest_end: number | null;
  latest_end: number | null;
  total_used_quota: string;
  total_count: number;
  active_count: number;
}

const SQL = `
WITH per_user AS (
  SELECT
    us.user_id,
    SUM(us.amount_used)  AS amount_used,
    SUM(us.amount_total) AS amount_total,
    COUNT(*)             AS subscription_count,
    STRING_AGG(DISTINCT sp.title, ', ')                                  AS plans,
    STRING_AGG(DISTINCT NULLIF(us.upgrade_group, ''), ', ')              AS upgrade_groups,
    MIN(us.end_time) AS earliest_end,
    MAX(us.end_time) AS latest_end
  FROM user_subscriptions us
  LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
  GROUP BY us.user_id
)
SELECT
  pu.user_id,
  u.username,
  u.display_name,
  pu.amount_used::text  AS amount_used,
  pu.amount_total::text AS amount_total,
  pu.subscription_count,
  COALESCE(NULLIF(pu.plans, ''), '-')          AS plans,
  COALESCE(NULLIF(pu.upgrade_groups, ''), '-') AS upgrade_groups,
  pu.earliest_end,
  pu.latest_end,
  (SELECT SUM(amount_used)::text FROM user_subscriptions) AS total_used_quota,
  (SELECT COUNT(*) FROM user_subscriptions)               AS total_count,
  (SELECT COUNT(*) FROM user_subscriptions WHERE status = 'active') AS active_count
FROM per_user pu
LEFT JOIN users u ON u.id = pu.user_id
ORDER BY pu.amount_used DESC
`;

export async function getSubscriptionsOverview(): Promise<SubscriptionsOverview> {
  const result = await query<UserUsageDbRow>(SQL);

  const rows: UserUsageRow[] = result.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    amountUsed: r.amount_used,
    amountTotal: r.amount_total,
    subscriptionCount: r.subscription_count,
    plans: r.plans || "-",
    upgradeGroups: r.upgrade_groups || "-",
    earliestEnd: r.earliest_end,
    latestEnd: r.latest_end,
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
