/** 订阅数据纯类型与纯函数（不依赖 DB，可安全用于 client 组件）。 */

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

/** 对已取回的行汇总（供占比分母复用）。 */
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

/** 单个订阅消耗占比（0..1），total=0 时返回 0。 */
export function computeUsageShare(amountUsed: string, totalUsed: number): number {
  if (!totalUsed) return 0;
  const used = Number(amountUsed);
  if (!Number.isFinite(used)) return 0;
  return used / totalUsed;
}
