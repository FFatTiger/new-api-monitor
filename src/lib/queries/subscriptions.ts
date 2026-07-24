import type { SubscriptionRow } from "./subscription-stats";

export type { SubscriptionRow };

export interface SubscriptionSummary {
  totalCount: number;
  activeCount: number;
  totalUsedQuota: string;
  totalQuota: string;
}

export interface SubscriptionsOverview {
  summary: SubscriptionSummary;
  rows: SubscriptionRow[];
  generatedAt: number; // 查询完成时的服务端 Unix 秒
}

import { query } from "../db.ts";

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

  return { summary, rows, generatedAt: Math.floor(Date.now() / 1000) };
}
