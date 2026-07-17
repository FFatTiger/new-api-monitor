export const DASHBOARD_ROLLUP_VERSION = 1;

/** Sparse masks: 0 global, token=1, user=2, model=4, channel=8, combined=15. */
export const DASHBOARD_DIMENSION_MASKS = [0, 1, 2, 4, 8, 15] as const;

export const DASHBOARD_DIMENSION_BITS = {
  token: 1,
  user: 2,
  model: 4,
  channel: 8,
} as const;

/** Grains: minute, hour, Asia/Shanghai day, all-time. */
export const DASHBOARD_ROLLUP_GRAINS = {
  minute: 1,
  hour: 2,
  day: 3,
  all: 4,
} as const;

/** Fixed advisory lock keys for rollup batch exclusivity. */
export const DASHBOARD_ROLLUP_ADVISORY_LOCK_CLASS = 884422;
export const DASHBOARD_ROLLUP_ADVISORY_LOCK_OBJECT = 1;

export interface DashboardRollupConfig {
  workerEnabled: boolean;
  readsEnabled: boolean;
  batchSize: number;
  pauseMs: number;
  statementTimeoutMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function clampInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function getDashboardRollupConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): DashboardRollupConfig {
  return {
    workerEnabled: parseBoolean(env.DASHBOARD_ROLLUP_WORKER_ENABLED, false),
    readsEnabled: parseBoolean(env.DASHBOARD_ROLLUP_READS_ENABLED, false),
    batchSize: clampInt(env.DASHBOARD_ROLLUP_BATCH_SIZE, 100, 10, 1000),
    pauseMs: clampInt(env.DASHBOARD_ROLLUP_PAUSE_MS, 500, 100, 60_000),
    statementTimeoutMs: clampInt(
      env.DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS,
      5000,
      1000,
      60_000,
    ),
  };
}
