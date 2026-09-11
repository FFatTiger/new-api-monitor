/**
 * 延迟分位数估算。
 *
 * ClickHouse 里存的是每分钟-维度的固定分桶计数（不是原始值），所以分位数
 * 只能由直方图近似：桶内按均匀分布线性插值。最后一个桶是开区间，只返回
 * 它的下界——宁可保守，也不假装知道尾部到底有多长。
 */

export const HISTOGRAM_BUCKET_PREFIXES = ["frt", "response"] as const;
export type HistogramPrefix = (typeof HISTOGRAM_BUCKET_PREFIXES)[number];

/** 把 `frt_bucket_0, frt_bucket_1, ...` 聚合成一个数组列。 */
export function histogramAggregateSql(prefix: HistogramPrefix, bucketCount: number): string {
  const terms = Array.from({ length: bucketCount }, (_, index) => `sum(${prefix}_bucket_${index})`);
  return `[${terms.join(", ")}] AS ${prefix}_hist`;
}

function toCounts(histogram: unknown): number[] {
  if (!Array.isArray(histogram)) return [];
  return histogram.map((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  });
}

/**
 * 由分桶计数估算分位数；无样本时返回 null。
 *
 * @param histogram 各桶计数，长度应为 bounds.length + 1
 * @param bounds    升序桶边界（与写入时一致）
 * @param quantile  0..1
 */
export function estimateQuantileFromHistogram(
  histogram: unknown,
  bounds: readonly number[],
  quantile: number,
): number | null {
  const counts = toCounts(histogram);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return null;
  if (!Number.isFinite(quantile)) return null;

  const clampedQuantile = Math.min(1, Math.max(0, quantile));
  const target = Math.max(1, clampedQuantile * total);

  let cumulative = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index]!;
    if (count <= 0) continue;

    const next = cumulative + count;
    if (target <= next) {
      const lower = index === 0 ? 0 : bounds[index - 1]!;
      if (index >= bounds.length) {
        // Open-ended bucket: the bound is all we honestly know.
        return lower;
      }

      const upper = bounds[index]!;
      const positionInBucket = (target - cumulative) / count;
      return lower + (upper - lower) * positionInBucket;
    }

    cumulative = next;
  }

  const lastBound = bounds[bounds.length - 1];
  return lastBound ?? null;
}
