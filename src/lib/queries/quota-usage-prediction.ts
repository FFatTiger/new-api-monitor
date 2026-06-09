import { query, withClient } from "../db.ts";
import { getQuotaUsageGroupsFromEnv, QUOTA_USAGE_WINDOW_OPTIONS, type QuotaUsageGroupMap } from "../quota/usage-config.ts";
import type { ProviderQuotaSnapshotInput } from "../quota/usage-aggregation.ts";
import type { ProviderType, QuotaUsagePredictionRow } from "../../types/quota.ts";

const SNAPSHOT_INTERVAL_SECONDS = 60;
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;
const RESET_TIME_DRIFT_TOLERANCE_SECONDS = 60;

type LatestSnapshot = {
  sampledAt: number;
  resetTime: string | null;
  remainingPercent: number | null;
  usedPercent: number | null;
};

type SnapshotDbRow = {
  sampled_at: string | number;
  reset_time: string | null;
  remaining_percent: string | number | null;
  used_percent: string | number | null;
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
  latestSampledAt: number | null;
  baselineUsedPercent: number | null;
  baselineSampledAt: number | null;
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

function parseResetTimeSeconds(value: string | number | null) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1000 : numeric);
  }

  const parsedMs = Date.parse(text);
  if (!Number.isFinite(parsedMs)) return null;
  return Math.floor(parsedMs / 1000);
}

function isSameResetWindow(left: string | number | null, right: string | number | null) {
  const normalizedLeft = normalizeResetTime(left);
  const normalizedRight = normalizeResetTime(right);
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft === null || normalizedRight === null) return false;

  const leftSeconds = parseResetTimeSeconds(normalizedLeft);
  const rightSeconds = parseResetTimeSeconds(normalizedRight);
  if (leftSeconds !== null && rightSeconds !== null) {
    return Math.abs(leftSeconds - rightSeconds) <= RESET_TIME_DRIFT_TOLERANCE_SECONDS;
  }

  return false;
}

function getTodayStartShanghaiSeconds(nowSeconds: number) {
  return Math.floor((nowSeconds + SHANGHAI_OFFSET_SECONDS) / 86_400) * 86_400 - SHANGHAI_OFFSET_SECONDS;
}

function getGptModelSql(expression: string) {
  return `(lower(${expression}) LIKE 'gpt%' OR lower(${expression}) LIKE '%codex%')`;
}

function mapSnapshot(row: SnapshotDbRow | undefined): LatestSnapshot | null {
  if (!row) return null;
  return {
    sampledAt: toNumber(row.sampled_at),
    resetTime: normalizeResetTime(row.reset_time),
    remainingPercent: nullableNumber(row.remaining_percent),
    usedPercent: nullableNumber(row.used_percent),
  };
}

function isUsableBaseline(latest: LatestSnapshot, baseline: LatestSnapshot | null) {
  if (!baseline) return false;
  if (latest.usedPercent === null || baseline.usedPercent === null) return false;
  if (baseline.sampledAt >= latest.sampledAt) return false;
  if (!isSameResetWindow(latest.resetTime, baseline.resetTime)) return false;
  return baseline.usedPercent <= latest.usedPercent;
}

export function shouldWriteQuotaSnapshot(previous: Pick<LatestSnapshot, "sampledAt" | "resetTime"> | null, next: { sampledAt: number; resetTime: string | number | null }) {
  if (!previous) return true;
  if (!isSameResetWindow(previous.resetTime, next.resetTime)) return true;
  return next.sampledAt - previous.sampledAt >= SNAPSHOT_INTERVAL_SECONDS;
}

export function getQuotaSnapshotRetentionSeconds() {
  const maxWindowMinutes = Math.max(...QUOTA_USAGE_WINDOW_OPTIONS.map((option) => option.minutes));
  return maxWindowMinutes * 60 + SNAPSHOT_INTERVAL_SECONDS;
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

  if (input.latestRemainingPercent === null || input.latestUsedPercent === null || input.latestSampledAt === null) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "no_snapshot" };
  }

  if (input.latestRemainingPercent <= 0) {
    return { ...base, minutesLeft: 0, exhaustAt: input.nowSeconds, status: "exhausted" };
  }

  if (input.baselineUsedPercent === null || input.baselineSampledAt === null) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "no_recent_usage" };
  }

  const deltaUsedPercent = input.latestUsedPercent - input.baselineUsedPercent;
  const deltaMinutes = (input.latestSampledAt - input.baselineSampledAt) / 60;
  if (deltaUsedPercent <= 0 || deltaMinutes <= 0) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "no_recent_usage" };
  }

  const percentPerMinute = deltaUsedPercent / deltaMinutes;
  const minutesLeft = Math.max(0, Math.round(input.latestRemainingPercent / percentPerMinute));
  const exhaustAt = input.nowSeconds + minutesLeft * 60;
  const resetSeconds = parseResetTimeSeconds(input.resetTime);

  if (resetSeconds !== null && resetSeconds > input.nowSeconds && exhaustAt >= resetSeconds) {
    return {
      ...base,
      minutesLeft: null,
      exhaustAt: null,
      status: "safe_until_reset",
    };
  }

  return {
    ...base,
    minutesLeft,
    exhaustAt,
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

    await client.query(`DELETE FROM quota_snapshots WHERE sampled_at < $1`, [nowSeconds - getQuotaSnapshotRetentionSeconds()]);
  });

  return { inserted };
}

async function getBaselineSnapshot(provider: ProviderType, latest: LatestSnapshot | null, windowStart: number) {
  if (!latest) return null;

  const beforeWindowResult = await query<SnapshotDbRow>(
    `
      SELECT sampled_at, reset_time, remaining_percent, used_percent
      FROM quota_snapshots
      WHERE provider = $1
        AND sampled_at <= $2::bigint
      ORDER BY sampled_at DESC
      LIMIT 1
    `,
    [provider, windowStart],
  );
  const beforeWindow = mapSnapshot(beforeWindowResult.rows[0]);
  if (isUsableBaseline(latest, beforeWindow)) return beforeWindow;

  const oldestInWindowResult = await query<SnapshotDbRow>(
    `
      SELECT sampled_at, reset_time, remaining_percent, used_percent
      FROM quota_snapshots
      WHERE provider = $1
        AND sampled_at > $2::bigint
        AND sampled_at < $3::bigint
      ORDER BY sampled_at ASC
      LIMIT 1
    `,
    [provider, windowStart, latest.sampledAt],
  );
  const oldestInWindow = mapSnapshot(oldestInWindowResult.rows[0]);
  return isUsableBaseline(latest, oldestInWindow) ? oldestInWindow : null;
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
        query<SnapshotDbRow>(
          `SELECT sampled_at, reset_time, remaining_percent, used_percent FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
          [provider],
        ),
      ]);

      const usage = usageResult.rows[0];
      const latest = mapSnapshot(snapshotResult.rows[0]);
      const baseline = await getBaselineSnapshot(provider, latest, recentStart);

      return buildQuotaUsagePrediction({
        provider,
        channelIds,
        todayGptTokens: toNumber(usage?.today_gpt_tokens),
        todayQuota: toNumber(usage?.today_quota),
        recentQuota: toNumber(usage?.recent_quota),
        windowMinutes,
        latestRemainingPercent: latest?.remainingPercent ?? null,
        latestUsedPercent: latest?.usedPercent ?? null,
        latestSampledAt: latest?.sampledAt ?? null,
        baselineUsedPercent: baseline?.usedPercent ?? null,
        baselineSampledAt: baseline?.sampledAt ?? null,
        resetTime: latest?.resetTime ?? null,
        nowSeconds,
      });
    }),
  );

  return rows;
}
