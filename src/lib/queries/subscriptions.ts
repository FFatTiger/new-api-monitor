import { query } from "../db.ts";

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
