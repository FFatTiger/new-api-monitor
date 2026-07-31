/** BigInt-safe subscription quota helpers (no raw quota is converted to Number). */

const QUOTA_PER_UNIT = BigInt(500_000);
const CENTS_PER_UNIT = BigInt(100);
const SHARE_SCALE = BigInt(1_000_000_000);

function parseQuota(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** Formats an integer quota exactly; invalid values retain their original text (or "0" when empty). */
export function formatQuotaInteger(value: string): string {
  const quota = parseQuota(value);
  return quota === null ? (value.trim() ? value : "0") : quota.toLocaleString("en-US");
}

/**
 * Converts quota to USD without floating point. Values are rounded to the nearest cent
 * (half away from zero), using the fixed 500,000 quota-per-dollar conversion.
 */
export function formatQuotaUsd(value: string): string {
  const quota = parseQuota(value);
  if (quota === null) return "$0.00";

  const negative = quota < BigInt(0);
  const absoluteQuota = negative ? -quota : quota;
  const cents = (absoluteQuota * CENTS_PER_UNIT + QUOTA_PER_UNIT / BigInt(2)) / QUOTA_PER_UNIT;
  const whole = cents / CENTS_PER_UNIT;
  const fraction = cents % CENTS_PER_UNIT;

  return `${negative ? "-$" : "$"}${whole.toLocaleString("en-US")}.${fraction.toString().padStart(2, "0")}`;
}

/** Single-user usage share (0..1), truncated to 1e-9 precision for chart display. */
export function computeUsageShare(amountUsed: string, totalUsed: string): number {
  const used = parseQuota(amountUsed);
  const total = parseQuota(totalUsed);

  if (used === null || total === null || used <= BigInt(0) || total <= BigInt(0)) return 0;
  if (used >= total) return 1;

  return Number((used * SHARE_SCALE) / total) / Number(SHARE_SCALE);
}

export interface UsageShareInput {
  name: string;
  amountUsed: string;
}

export interface UsageShareDatum {
  name: string;
  share: number;
}

/** Builds chart ratios in the SQL-provided order; raw quota never enters chart numeric data. */
export function buildUsageShareData(
  rows: UsageShareInput[],
  totalUsed: string,
  topN: number,
): UsageShareDatum[] {
  const total = parseQuota(totalUsed);
  if (total === null || total <= BigInt(0)) return [];

  const ranked = rows.map((row) => ({
    name: row.name,
    share: computeUsageShare(row.amountUsed, totalUsed),
  }));
  const top = ranked.slice(0, topN);
  const rest = ranked.slice(topN);

  if (rest.length > 0) {
    top.push({
      name: `其他 (${rest.length})`,
      share: rest.reduce((sum, row) => sum + row.share, 0),
    });
  }

  return top;
}
