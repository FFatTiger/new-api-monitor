import { query, withClient } from "../db.ts";
import { getQuotaUsageGroupsFromEnv, type QuotaUsageGroupMap } from "../quota/usage-config.ts";
import type { ProviderQuotaSnapshotInput } from "../quota/usage-aggregation.ts";
import type { ProviderType, QuotaUsagePredictionRow } from "../../types/quota.ts";

const SNAPSHOT_INTERVAL_SECONDS = 5 * 60;
const SNAPSHOT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;

type LatestSnapshot = {
  sampledAt: number;
  resetTime: string | null;
  remainingPercent: number | null;
  usedPercent: number | null;
};

type PredictionInput = {
  provider: ProviderType;
  channelIds: number[];
  todayGptTokens: number;
  todayQuota: number;
  recentQuota: number;
  windowMinutes: number;
  latestRemainingPercent: number | null;
  latestUsedPercent: number | null;
  resetTime: string | null;
  nowSeconds: number;
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const numeric = toNumber(value, NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeResetTime(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function getTodayStartShanghaiSeconds(nowSeconds: number) {
  return Math.floor((nowSeconds + SHANGHAI_OFFSET_SECONDS) / 86_400) * 86_400 - SHANGHAI_OFFSET_SECONDS;
}

function getGptModelSql(expression: string) {
  return `(lower(${expression}) LIKE 'gpt%' OR lower(${expression}) LIKE '%codex%')`;
}

export function shouldWriteQuotaSnapshot(previous: Pick<LatestSnapshot, "sampledAt" | "resetTime"> | null, next: { sampledAt: number; resetTime: string | number | null }) {
  if (!previous) return true;
  const previousReset = normalizeResetTime(previous.resetTime);
  const nextReset = normalizeResetTime(next.resetTime);
  if (previousReset !== nextReset) return true;
  return next.sampledAt - previous.sampledAt >= SNAPSHOT_INTERVAL_SECONDS;
}

export function buildQuotaUsagePrediction(input: PredictionInput): QuotaUsagePredictionRow {
  const recentQuotaPerHour = input.windowMinutes > 0 ? input.recentQuota / (input.windowMinutes / 60) : null;
  const base = {
    provider: input.provider,
    channelIds: input.channelIds,
    configured: true,
    todayGptTokens: input.todayGptTokens,
    todayQuota: input.todayQuota,
    recentQuota: input.recentQuota,
    recentQuotaPerHour,
    latestRemainingPercent: input.latestRemainingPercent,
    latestUsedPercent: input.latestUsedPercent,
    resetTime: input.resetTime,
  };

  if (input.latestRemainingPercent === null || input.latestUsedPercent === null) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "no_snapshot" };
  }

  if (input.latestRemainingPercent <= 0) {
    return { ...base, minutesLeft: 0, exhaustAt: input.nowSeconds, status: "exhausted" };
  }

  const quotaPerMinute = input.windowMinutes > 0 ? input.recentQuota / input.windowMinutes : 0;
  if (quotaPerMinute <= 0 || input.latestUsedPercent <= 0 || input.todayQuota <= 0) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "no_recent_usage" };
  }

  const estimatedTotalQuota = input.todayQuota / (input.latestUsedPercent / 100);
  const remainingQuota = estimatedTotalQuota * (input.latestRemainingPercent / 100);
  const minutesLeft = Math.max(0, Math.round(remainingQuota / quotaPerMinute));

  return {
    ...base,
    minutesLeft,
    exhaustAt: input.nowSeconds + minutesLeft * 60,
    status: "ready",
  };
}

export async function ensureQuotaSnapshotTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      remaining_percent DOUBLE PRECISION,
      used_percent DOUBLE PRECISION,
      reset_time TEXT,
      sampled_at BIGINT NOT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_quota_snapshots_provider_sampled_at ON quota_snapshots (provider, sampled_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_quota_snapshots_sampled_at ON quota_snapshots (sampled_at DESC)`);
}

export async function recordQuotaSnapshots(snapshots: ProviderQuotaSnapshotInput[], nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!snapshots.length) return { inserted: 0 };

  await ensureQuotaSnapshotTable();
  let inserted = 0;

  await withClient(async (client) => {
    for (const snapshot of snapshots) {
      const latestResult = await client.query<{ sampled_at: string | number; reset_time: string | null }>(
        `SELECT sampled_at, reset_time FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
        [snapshot.provider],
      );
      const latest = latestResult.rows[0]
        ? { sampledAt: toNumber(latestResult.rows[0].sampled_at), resetTime: latestResult.rows[0].reset_time }
        : null;

      if (!shouldWriteQuotaSnapshot(latest, { sampledAt: nowSeconds, resetTime: snapshot.resetTime })) continue;

      await client.query(
        `INSERT INTO quota_snapshots (provider, remaining_percent, used_percent, reset_time, sampled_at) VALUES ($1, $2, $3, $4, $5)`,
        [snapshot.provider, snapshot.remainingPercent, snapshot.usedPercent, normalizeResetTime(snapshot.resetTime), nowSeconds],
      );
      inserted += 1;
    }

    await client.query(`DELETE FROM quota_snapshots WHERE sampled_at < $1`, [nowSeconds - SNAPSHOT_RETENTION_SECONDS]);
  });

  return { inserted };
}

export async function getQuotaUsagePredictions(
  windowMinutes: number,
  groups: QuotaUsageGroupMap = getQuotaUsageGroupsFromEnv(),
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const providers = Object.keys(groups) as ProviderType[];
  if (!providers.length) return [] as QuotaUsagePredictionRow[];

  await ensureQuotaSnapshotTable();

  const todayStart = getTodayStartShanghaiSeconds(nowSeconds);
  const recentStart = nowSeconds - windowMinutes * 60;

  const rows = await Promise.all(
    providers.map(async (provider) => {
      const channelIds = groups[provider] || [];
      if (!channelIds.length) {
        return {
          provider,
          channelIds: [],
          configured: false,
          todayGptTokens: 0,
          todayQuota: 0,
          recentQuota: 0,
          recentQuotaPerHour: null,
          latestRemainingPercent: null,
          latestUsedPercent: null,
          resetTime: null,
          minutesLeft: null,
          exhaustAt: null,
          status: "unconfigured",
        } satisfies QuotaUsagePredictionRow;
      }

      const [usageResult, snapshotResult] = await Promise.all([
        query<{ today_gpt_tokens: string | number; today_quota: string | number; recent_quota: string | number }>(
          `
            SELECT
              COALESCE(SUM(CASE WHEN l.created_at >= $2::bigint AND ${getGptModelSql("COALESCE(l.model_name, '')")} THEN COALESCE(l.prompt_tokens, 0) + COALESCE(l.completion_tokens, 0) ELSE 0 END), 0) AS today_gpt_tokens,
              COALESCE(SUM(CASE WHEN l.created_at >= $2::bigint THEN COALESCE(l.quota, 0) ELSE 0 END), 0) AS today_quota,
              COALESCE(SUM(CASE WHEN l.created_at >= $3::bigint THEN COALESCE(l.quota, 0) ELSE 0 END), 0) AS recent_quota
            FROM logs l
            WHERE l.channel_id = ANY($1::bigint[])
              AND l.created_at >= LEAST($2::bigint, $3::bigint)
          `,
          [channelIds, todayStart, recentStart],
        ),
        query<{ remaining_percent: string | number | null; used_percent: string | number | null; reset_time: string | null }>(
          `SELECT remaining_percent, used_percent, reset_time FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
          [provider],
        ),
      ]);

      const usage = usageResult.rows[0];
      const snapshot = snapshotResult.rows[0];

      return buildQuotaUsagePrediction({
        provider,
        channelIds,
        todayGptTokens: toNumber(usage?.today_gpt_tokens),
        todayQuota: toNumber(usage?.today_quota),
        recentQuota: toNumber(usage?.recent_quota),
        windowMinutes,
        latestRemainingPercent: nullableNumber(snapshot?.remaining_percent),
        latestUsedPercent: nullableNumber(snapshot?.used_percent),
        resetTime: normalizeResetTime(snapshot?.reset_time),
        nowSeconds,
      });
    }),
  );

  return rows;
}
