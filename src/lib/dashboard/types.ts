/**
 * Shared contracts for dashboard incremental rollups.
 * Metric/source shapes use bigint-compatible fields; normalization is implemented later.
 */

export type DashboardRollupLane = "live" | "history" | "gap";

/** Grain codes: 1 minute, 2 hour, 3 Asia/Shanghai day, 4 all-time. */
export type DashboardRollupGrain = 1 | 2 | 3 | 4;

/** Sparse dimension masks persisted by the worker. */
export type DashboardRollupMask = 0 | 1 | 2 | 4 | 8 | 15;

export type DashboardRollupGrainName = "minute" | "hour" | "day" | "all";

export interface DashboardRollupRangeSegment {
  grain: DashboardRollupGrain;
  /** Inclusive start unix seconds (minute-aligned). */
  start: number;
  /** Exclusive end unix seconds (minute-aligned). */
  end: number;
}

/**
 * Raw source projection from `logs`. Values may arrive as number or string
 * (pg bigint/numeric). Callers normalize later; this layer only defines shape.
 */
export interface DashboardSourceLogRow {
  id: string | number | bigint;
  created_at: string | number | bigint;
  token_id: string | number | bigint | null;
  token_name: string | null;
  user_id: string | number | bigint | null;
  username: string | null;
  model_name: string | null;
  channel_id: string | number | bigint | null;
  channel_name: string | null;
  prompt_tokens: string | number | bigint | null;
  completion_tokens: string | number | bigint | null;
  type: string | number | bigint | null;
  use_time: string | number | bigint | null;
  other: string | null;
}

/**
 * Normalized metric totals for one source event / rollup cell.
 * Integer counters are bigint-compatible; averages stay sum/count until read.
 */
export interface DashboardRollupMetricTotals {
  requestCount: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  cacheTokens: bigint;
  attemptCount: bigint;
  successCount: bigint;
  errorCount: bigint;
  firstTokenLatencySum: number;
  firstTokenLatencyCount: bigint;
  responseTimeSum: number;
  responseTimeCount: bigint;
  outputTokensPerSecSum: number;
  outputTokensPerSecCount: bigint;
  firstUsedAt: number;
  latestUsedAt: number;
  representativeUserId: bigint | null;
  representativeUsername: string | null;
  representativeChannelName: string | null;
}

export interface DashboardDimensionKey {
  dimensionMask: DashboardRollupMask;
  tokenId: bigint | null;
  tokenName: string | null;
  userId: bigint | null;
  username: string | null;
  modelName: string | null;
  channelId: bigint | null;
}

export interface PendingDashboardRollupCell {
  grain: DashboardRollupGrain;
  bucketStart: number;
  dimensionMask: DashboardRollupMask;
  dimension: DashboardDimensionKey;
  metrics: DashboardRollupMetricTotals;
}

export type DashboardRollupReadiness =
  | {
      kind: "ready";
      version: number;
      processedRows: number;
      processedMinCreatedAt: number | null;
      processedMaxCreatedAt: number | null;
    }
  | {
      kind: "building" | "disabled" | "unhealthy" | "initializing" | "unsupported";
      processedRows: number;
      safeMessage: string;
    };

export type DashboardRollupWorkItem =
  | { lane: "live"; version: number }
  | { lane: "history"; version: number }
  | { lane: "gap"; version: number; gapStartId: bigint; gapEndId: bigint };

export interface DashboardRollupBatchResult {
  lane: DashboardRollupLane;
  version: number;
  fetchedRows: number;
  claimedRows: number;
  groupedCells: number;
  durationMs: number;
  liveCursorId: string;
  historyCursorId: string | null;
  historyComplete: boolean;
  lagIdSpan: string | null;
  malformedOtherRows: number;
}
