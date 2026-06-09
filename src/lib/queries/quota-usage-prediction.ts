import { query, withClient } from "../db.ts";
import { getQuotaUsageGroupsFromEnv, type QuotaUsageGroupMap } from "../quota/usage-config.ts";
import type { ProviderQuotaSnapshotInput } from "../quota/usage-aggregation.ts";
import type { ProviderType, QuotaUsagePredictionRow } from "../../types/quota.ts";

const SNAPSHOT_INTERVAL_SECONDS = 60;
const SNAPSHOT_RETENTION_SECONDS = 24 * 60 * 60 + SNAPSHOT_INTERVAL_SECONDS;
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;
const RESET_TIME_DRIFT_TOLERANCE_SECONDS = 60;

type LatestSnapshot = {
  sampledAt: number;
  resetTime: string | null;
  remainingPercent: number | null;
  usedPercent: number | null;
};

export type QuotaUsageCoefficientState = {
  quotaPerPercent: number | null;
  pendingQuota: number;
  pendingStartedAt: number | null;
  pendingStartedUsedPercent: number | null;
  lastSnapshotAt: number | null;
  lastUsedPercent: number | null;
  lastResetTime: string | null;
  lastIntervalQuota: number;
  lastIntervalMinutes: number | null;
};

type PredictionInput = {
  provider: ProviderType;
  channelIds: number[];
  todayGptTokens: number;
  todayQuota: number;
  quotaPerPercent: number | null;
  recentQuota: number;
  recentMinutes: number | null;
  latestRemainingPercent: number | null;
  latestUsedPercent: number | null;
  resetTime: string | null;
  nowSeconds: number;
};

type QuotaUsageCoefficientDbRow = {
  quota_per_percent: string | number | null;
  pending_quota: string | number | null;
  pending_started_at: string | number | null;
  pending_started_used_percent: string | number | null;
  last_snapshot_at: string | number | null;
  last_used_percent: string | number | null;
  last_reset_time: string | null;
  last_interval_quota: string | number | null;
  last_interval_minutes: string | number | null;
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

function createCoefficientStateFromSnapshot(snapshot: { sampledAt: number; usedPercent: number | null; resetTime: string | null }): QuotaUsageCoefficientState {
  return {
    quotaPerPercent: null,
    pendingQuota: 0,
    pendingStartedAt: snapshot.sampledAt,
    pendingStartedUsedPercent: snapshot.usedPercent,
    lastSnapshotAt: snapshot.sampledAt,
    lastUsedPercent: snapshot.usedPercent,
    lastResetTime: normalizeResetTime(snapshot.resetTime),
    lastIntervalQuota: 0,
    lastIntervalMinutes: null,
  };
}

function mapCoefficientState(row: QuotaUsageCoefficientDbRow): QuotaUsageCoefficientState {
  return {
    quotaPerPercent: nullableNumber(row.quota_per_percent),
    pendingQuota: toNumber(row.pending_quota),
    pendingStartedAt: nullableNumber(row.pending_started_at),
    pendingStartedUsedPercent: nullableNumber(row.pending_started_used_percent),
    lastSnapshotAt: nullableNumber(row.last_snapshot_at),
    lastUsedPercent: nullableNumber(row.last_used_percent),
    lastResetTime: normalizeResetTime(row.last_reset_time),
    lastIntervalQuota: toNumber(row.last_interval_quota),
    lastIntervalMinutes: nullableNumber(row.last_interval_minutes),
  };
}

export function shouldWriteQuotaSnapshot(previous: Pick<LatestSnapshot, "sampledAt" | "resetTime"> | null, next: { sampledAt: number; resetTime: string | number | null }) {
  if (!previous) return true;
  if (!isSameResetWindow(previous.resetTime, next.resetTime)) return true;
  return next.sampledAt - previous.sampledAt >= SNAPSHOT_INTERVAL_SECONDS;
}

export function getQuotaSnapshotRetentionSeconds() {
  return SNAPSHOT_RETENTION_SECONDS;
}

export function advanceQuotaUsageCoefficient(
  previous: QuotaUsageCoefficientState,
  snapshot: { sampledAt: number; usedPercent: number | null; resetTime: string | number | null },
  intervalQuota: number,
): QuotaUsageCoefficientState {
  const currentResetTime = normalizeResetTime(snapshot.resetTime);
  const safeIntervalQuota = Math.max(0, intervalQuota);
  const intervalMinutes = previous.lastSnapshotAt !== null && snapshot.sampledAt > previous.lastSnapshotAt ? (snapshot.sampledAt - previous.lastSnapshotAt) / 60 : null;
  const base = {
    lastSnapshotAt: snapshot.sampledAt,
    lastUsedPercent: snapshot.usedPercent,
    lastResetTime: currentResetTime,
    lastIntervalQuota: safeIntervalQuota,
    lastIntervalMinutes: intervalMinutes,
  };

  const currentUsedPercent = snapshot.usedPercent;
  const lastUsedPercent = previous.lastUsedPercent;
  const hasComparablePercent = lastUsedPercent !== null && currentUsedPercent !== null;
  const resetChanged = previous.lastSnapshotAt !== null && !isSameResetWindow(previous.lastResetTime, currentResetTime);
  const usedDecreased = hasComparablePercent && currentUsedPercent < lastUsedPercent;

  if (!hasComparablePercent || resetChanged || usedDecreased) {
    return {
      quotaPerPercent: null,
      pendingQuota: 0,
      pendingStartedAt: snapshot.sampledAt,
      pendingStartedUsedPercent: snapshot.usedPercent,
      ...base,
    };
  }

  const pendingStartedUsedPercent = previous.pendingStartedUsedPercent ?? lastUsedPercent;
  const pendingStartedAt = previous.pendingStartedAt ?? previous.lastSnapshotAt;
  const accumulatedQuota = previous.pendingQuota + safeIntervalQuota;
  const deltaUsedPercent = currentUsedPercent - pendingStartedUsedPercent;

  if (deltaUsedPercent > 0) {
    return {
      quotaPerPercent: accumulatedQuota > 0 ? accumulatedQuota / deltaUsedPercent : previous.quotaPerPercent,
      pendingQuota: 0,
      pendingStartedAt: snapshot.sampledAt,
      pendingStartedUsedPercent: snapshot.usedPercent,
      ...base,
    };
  }

  return {
    quotaPerPercent: previous.quotaPerPercent,
    pendingQuota: accumulatedQuota,
    pendingStartedAt,
    pendingStartedUsedPercent,
    ...base,
  };
}

export function buildQuotaUsagePrediction(input: PredictionInput): QuotaUsagePredictionRow {
  const quotaPerMinute = input.recentMinutes && input.recentMinutes > 0 ? input.recentQuota / input.recentMinutes : 0;
  const recentQuotaPerHour = quotaPerMinute > 0 ? quotaPerMinute * 60 : null;
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

  if (input.quotaPerPercent === null || input.quotaPerPercent <= 0) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "calibrating" };
  }

  if (quotaPerMinute <= 0) {
    return { ...base, minutesLeft: null, exhaustAt: null, status: "no_recent_usage" };
  }

  const remainingQuota = input.latestRemainingPercent * input.quotaPerPercent;
  const minutesLeft = Math.max(0, Math.round(remainingQuota / quotaPerMinute));
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
  await query(`
    CREATE TABLE IF NOT EXISTS quota_usage_coefficients (
      provider TEXT PRIMARY KEY,
      quota_per_percent DOUBLE PRECISION,
      pending_quota DOUBLE PRECISION NOT NULL DEFAULT 0,
      pending_started_at BIGINT,
      pending_started_used_percent DOUBLE PRECISION,
      last_snapshot_at BIGINT,
      last_used_percent DOUBLE PRECISION,
      last_reset_time TEXT,
      last_interval_quota DOUBLE PRECISION NOT NULL DEFAULT 0,
      last_interval_minutes DOUBLE PRECISION,
      updated_at BIGINT NOT NULL
    )
  `);
}

async function sumQuotaBetween(client: { query: typeof query }, channelIds: number[], startExclusive: number, endInclusive: number) {
  if (!channelIds.length || endInclusive <= startExclusive) return 0;
  const result = await client.query<{ quota: string | number }>(
    `
      SELECT COALESCE(SUM(COALESCE(l.quota, 0)), 0) AS quota
      FROM logs l
      WHERE l.channel_id = ANY($1::bigint[])
        AND l.created_at > $2::bigint
        AND l.created_at <= $3::bigint
    `,
    [channelIds, startExclusive, endInclusive],
  );
  return toNumber(result.rows[0]?.quota);
}

async function upsertQuotaUsageCoefficient(client: { query: typeof query }, provider: ProviderType, state: QuotaUsageCoefficientState, updatedAt: number) {
  await client.query(
    `
      INSERT INTO quota_usage_coefficients (
        provider,
        quota_per_percent,
        pending_quota,
        pending_started_at,
        pending_started_used_percent,
        last_snapshot_at,
        last_used_percent,
        last_reset_time,
        last_interval_quota,
        last_interval_minutes,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (provider) DO UPDATE SET
        quota_per_percent = EXCLUDED.quota_per_percent,
        pending_quota = EXCLUDED.pending_quota,
        pending_started_at = EXCLUDED.pending_started_at,
        pending_started_used_percent = EXCLUDED.pending_started_used_percent,
        last_snapshot_at = EXCLUDED.last_snapshot_at,
        last_used_percent = EXCLUDED.last_used_percent,
        last_reset_time = EXCLUDED.last_reset_time,
        last_interval_quota = EXCLUDED.last_interval_quota,
        last_interval_minutes = EXCLUDED.last_interval_minutes,
        updated_at = EXCLUDED.updated_at
    `,
    [
      provider,
      state.quotaPerPercent,
      state.pendingQuota,
      state.pendingStartedAt,
      state.pendingStartedUsedPercent,
      state.lastSnapshotAt,
      state.lastUsedPercent,
      state.lastResetTime,
      state.lastIntervalQuota,
      state.lastIntervalMinutes,
      updatedAt,
    ],
  );
}

export async function recordQuotaSnapshots(snapshots: ProviderQuotaSnapshotInput[], nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!snapshots.length) return { inserted: 0 };

  await ensureQuotaSnapshotTable();
  const groups = getQuotaUsageGroupsFromEnv();
  let inserted = 0;

  await withClient(async (client) => {
    for (const snapshot of snapshots) {
      const latestResult = await client.query<{
        sampled_at: string | number;
        reset_time: string | null;
        remaining_percent: string | number | null;
        used_percent: string | number | null;
      }>(
        `SELECT sampled_at, reset_time, remaining_percent, used_percent FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
        [snapshot.provider],
      );
      const latest = latestResult.rows[0]
        ? {
            sampledAt: toNumber(latestResult.rows[0].sampled_at),
            resetTime: latestResult.rows[0].reset_time,
            remainingPercent: nullableNumber(latestResult.rows[0].remaining_percent),
            usedPercent: nullableNumber(latestResult.rows[0].used_percent),
          }
        : null;

      if (!shouldWriteQuotaSnapshot(latest, { sampledAt: nowSeconds, resetTime: snapshot.resetTime })) continue;

      const normalizedResetTime = normalizeResetTime(snapshot.resetTime);
      await client.query(
        `INSERT INTO quota_snapshots (provider, remaining_percent, used_percent, reset_time, sampled_at) VALUES ($1, $2, $3, $4, $5)`,
        [snapshot.provider, snapshot.remainingPercent, snapshot.usedPercent, normalizedResetTime, nowSeconds],
      );
      inserted += 1;

      const channelIds = groups[snapshot.provider] || [];
      if (!channelIds.length) continue;

      if (!latest) {
        await upsertQuotaUsageCoefficient(
          client,
          snapshot.provider,
          createCoefficientStateFromSnapshot({ sampledAt: nowSeconds, usedPercent: snapshot.usedPercent, resetTime: normalizedResetTime }),
          nowSeconds,
        );
        continue;
      }

      const coefficientResult = await client.query<QuotaUsageCoefficientDbRow>(
        `
          SELECT
            quota_per_percent,
            pending_quota,
            pending_started_at,
            pending_started_used_percent,
            last_snapshot_at,
            last_used_percent,
            last_reset_time,
            last_interval_quota,
            last_interval_minutes
          FROM quota_usage_coefficients
          WHERE provider = $1
        `,
        [snapshot.provider],
      );
      const previousState = coefficientResult.rows[0]
        ? mapCoefficientState(coefficientResult.rows[0])
        : createCoefficientStateFromSnapshot({ sampledAt: latest.sampledAt, usedPercent: latest.usedPercent, resetTime: latest.resetTime });
      const intervalQuota = await sumQuotaBetween(client, channelIds, latest.sampledAt, nowSeconds);
      const nextState = advanceQuotaUsageCoefficient(
        previousState,
        { sampledAt: nowSeconds, usedPercent: snapshot.usedPercent, resetTime: normalizedResetTime },
        intervalQuota,
      );

      await upsertQuotaUsageCoefficient(client, snapshot.provider, nextState, nowSeconds);
    }

    await client.query(`DELETE FROM quota_snapshots WHERE sampled_at < $1`, [nowSeconds - getQuotaSnapshotRetentionSeconds()]);
  });

  return { inserted };
}

export async function getQuotaUsagePredictions(
  groups: QuotaUsageGroupMap = getQuotaUsageGroupsFromEnv(),
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const providers = Object.keys(groups) as ProviderType[];
  if (!providers.length) return [] as QuotaUsagePredictionRow[];

  await ensureQuotaSnapshotTable();

  const todayStart = getTodayStartShanghaiSeconds(nowSeconds);

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

      const [usageResult, snapshotResult, coefficientResult] = await Promise.all([
        query<{ today_gpt_tokens: string | number; today_quota: string | number }>(
          `
            SELECT
              COALESCE(SUM(CASE WHEN ${getGptModelSql("COALESCE(l.model_name, '')")} THEN COALESCE(l.prompt_tokens, 0) + COALESCE(l.completion_tokens, 0) ELSE 0 END), 0) AS today_gpt_tokens,
              COALESCE(SUM(COALESCE(l.quota, 0)), 0) AS today_quota
            FROM logs l
            WHERE l.channel_id = ANY($1::bigint[])
              AND l.created_at >= $2::bigint
          `,
          [channelIds, todayStart],
        ),
        query<{ remaining_percent: string | number | null; used_percent: string | number | null; reset_time: string | null }>(
          `SELECT remaining_percent, used_percent, reset_time FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
          [provider],
        ),
        query<QuotaUsageCoefficientDbRow>(
          `
            SELECT
              quota_per_percent,
              pending_quota,
              pending_started_at,
              pending_started_used_percent,
              last_snapshot_at,
              last_used_percent,
              last_reset_time,
              last_interval_quota,
              last_interval_minutes
            FROM quota_usage_coefficients
            WHERE provider = $1
          `,
          [provider],
        ),
      ]);

      const usage = usageResult.rows[0];
      const snapshot = snapshotResult.rows[0];
      const coefficient = coefficientResult.rows[0] ? mapCoefficientState(coefficientResult.rows[0]) : null;

      return buildQuotaUsagePrediction({
        provider,
        channelIds,
        todayGptTokens: toNumber(usage?.today_gpt_tokens),
        todayQuota: toNumber(usage?.today_quota),
        quotaPerPercent: coefficient?.quotaPerPercent ?? null,
        recentQuota: coefficient?.lastIntervalQuota ?? 0,
        recentMinutes: coefficient?.lastIntervalMinutes ?? null,
        latestRemainingPercent: nullableNumber(snapshot?.remaining_percent),
        latestUsedPercent: nullableNumber(snapshot?.used_percent),
        resetTime: normalizeResetTime(snapshot?.reset_time),
        nowSeconds,
      });
    }),
  );

  return rows;
}
