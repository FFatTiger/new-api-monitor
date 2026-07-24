/** 订阅占比纯函数（不依赖 DB，可安全用于 client 组件）。 */

/** 单个用户消耗占比（0..1），total=0 时返回 0。 */
export function computeUsageShare(amountUsed: string, totalUsed: number): number {
  if (!totalUsed) return 0;
  const used = Number(amountUsed);
  if (!Number.isFinite(used)) return 0;
  return used / totalUsed;
}
