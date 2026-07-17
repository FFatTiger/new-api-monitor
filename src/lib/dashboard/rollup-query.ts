import {
  withTransaction,
  type DbClient,
  type TransactionOptions,
} from "../db.ts";
import type {
  ChannelRankingRow,
  ChannelStabilityRow,
  DashboardFilters,
  ModelRankingRow,
  ModelStabilityRow,
  StabilitySummary,
  SummaryMetrics,
  TokenDetailData,
  TokenRankingRow,
  TrendPoint,
  UserRankingRow,
} from "../queries/dashboard.ts";
import {
  DASHBOARD_ROLLUP_GRAINS,
  getDashboardRollupConfig,
  type DashboardRollupConfig,
} from "./rollup-config.ts";
import {
  decomposeDashboardRange,
  getClosedDashboardWatermark,
  getDashboardThirtyDayRange,
} from "./rollup-time.ts";
import type {
  DashboardLongRangePreset,
  DashboardRollupRangeSegment,
  DashboardRollupReadiness,
} from "./types.ts";

export type { DashboardLongRangePreset };

export interface DashboardRollupQueryPlan {
  kind: "rollup";
  preset: DashboardLongRangePreset;
  version: number;
  filters: DashboardFilters;
  startTimestamp: number | null;
  endTimestamp: number | null;
  segments: DashboardRollupRangeSegment[];
}

export interface DashboardRollupPacket {
  summary: SummaryMetrics;
  stabilitySummary: StabilitySummary;
  tokenRankings: TokenRankingRow[];
  userRankings: UserRankingRow[];
  modelRankings: ModelRankingRow[];
  channelRankings: ChannelRankingRow[];
  modelStability: ModelStabilityRow[];
  channelStability: ChannelStabilityRow[];
  trend: TrendPoint[];
  granularity: "day";
}

export type DashboardRollupPacketResult =
  | { kind: "ready"; data: DashboardRollupPacket }
  | { kind: "error"; safeMessage: string };

export type DashboardRollupTokenDetailResult =
  | { kind: "ready"; detail: TokenDetailData }
  | { kind: "error"; safeMessage: string };

type PacketQueryName = "summary" | "rankings" | "stability" | "trend";
type DetailQueryName = "summary" | "models" | "channels";

export interface DashboardRollupNamedQuery<Name extends string = string> {
  name: Name;
  text: string;
  values: unknown[];
}

const READ_TX: Omit<TransactionOptions, "statementTimeoutMs"> = {
  isolationLevel: "repeatable read",
  readOnly: true,
  disableParallelGather: true,
};

const SAFE_PACKET_ERROR = "长期统计读取失败，请稍后重试。";
const SAFE_DISABLED = "长期统计尚未启用。";
const SAFE_BUILDING =
  "正在分批构建长期统计\n已永久处理的日志会逐步累计；页面不会执行全表计算。";
const SAFE_UNHEALTHY = "长期统计暂时不可用，请稍后重试。";
const SAFE_INITIALIZING = "长期统计正在初始化，请稍后重试。";

type WithTransactionFn = <T>(
  callback: (client: DbClient) => Promise<T>,
  options?: TransactionOptions,
) => Promise<T>;

let withTransactionImpl: WithTransactionFn = withTransaction;

/** Test-only seam for public wrappers. */
export function __setWithTransactionForTests(fn: WithTransactionFn): void {
  withTransactionImpl = fn;
}

/** Test-only reset. */
export function __resetRollupQueryTestHooks(): void {
  withTransactionImpl = withTransaction;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : fallback;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function getNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function divideNullable(sum: unknown, count: unknown): number | null {
  const c = toNumber(count, 0);
  if (c <= 0) return null;
  const s = getNullableNumber(sum);
  if (s === null) return null;
  return s / c;
}

function isPgUndefinedTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}

function logSafe(context: string, error: unknown): void {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const name = error instanceof Error ? error.name : "Error";
  console.error(`[dashboard-rollup-query] ${context}`, { name, code });
}

function hasAnyFilter(filters: DashboardFilters): boolean {
  return Boolean(filters.token || filters.username || filters.model || filters.channelId);
}

export function getDashboardFilterMask(filters: DashboardFilters): 0 | 15 {
  return hasAnyFilter(filters) ? 15 : 0;
}

export function getDashboardRequiredMasks(filters: DashboardFilters): number[] {
  return getDashboardFilterMask(filters) === 15 ? [15] : [0, 1, 2, 4, 8];
}

function formatProcessedRowsMessage(processedRows: number): string {
  return `正在分批构建长期统计\n已永久处理 ${processedRows.toLocaleString("zh-CN")} 条日志；页面不会执行全表计算。`;
}

interface RegistryRow {
  active_version: unknown;
  building_version: unknown;
}

interface StateRow {
  version: unknown;
  status: unknown;
  history_complete: unknown;
  processed_rows: unknown;
  processed_min_created_at: unknown;
  processed_max_created_at: unknown;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

function readStateStatus(status: unknown): string {
  return typeof status === "string" ? status : String(status ?? "");
}

export async function readDashboardRollupReadiness(
  client: DbClient,
  _config: DashboardRollupConfig,
): Promise<DashboardRollupReadiness> {
  const registryResult = await client.query(
    `SELECT active_version, building_version
     FROM dashboard_rollup_registry
     WHERE singleton = TRUE`,
  );
  const registry = registryResult.rows[0] as RegistryRow | undefined;
  if (!registry) {
    return {
      kind: "initializing",
      processedRows: 0,
      safeMessage: SAFE_INITIALIZING,
    };
  }

  const activeVersion =
    registry.active_version === null || registry.active_version === undefined
      ? null
      : toNumber(registry.active_version, NaN);
  const buildingVersion =
    registry.building_version === null || registry.building_version === undefined
      ? null
      : toNumber(registry.building_version, NaN);

  if (activeVersion !== null && Number.isFinite(activeVersion)) {
    const stateResult = await client.query(
      `SELECT version, status, history_complete, processed_rows,
              processed_min_created_at, processed_max_created_at
       FROM dashboard_rollup_state
       WHERE version = $1`,
      [activeVersion],
    );
    const state = stateResult.rows[0] as StateRow | undefined;
    if (!state) {
      return {
        kind: "initializing",
        processedRows: 0,
        safeMessage: SAFE_INITIALIZING,
      };
    }

    const processedRows = toNumber(state.processed_rows, 0);
    const status = readStateStatus(state.status);
    if (status === "unhealthy") {
      return {
        kind: "unhealthy",
        processedRows,
        safeMessage: SAFE_UNHEALTHY,
      };
    }
    if (status === "inactive") {
      return {
        kind: "building",
        processedRows,
        safeMessage: formatProcessedRowsMessage(processedRows),
      };
    }
    if (status === "building") {
      return {
        kind: "building",
        processedRows,
        safeMessage: formatProcessedRowsMessage(processedRows),
      };
    }
    if (status === "active" && asBoolean(state.history_complete)) {
      const processedMax =
        state.processed_max_created_at === null || state.processed_max_created_at === undefined
          ? null
          : toNumber(state.processed_max_created_at);
      if (processedMax === null) {
        return {
          kind: "building",
          processedRows,
          safeMessage: formatProcessedRowsMessage(processedRows),
        };
      }
      const processedMin =
        state.processed_min_created_at === null || state.processed_min_created_at === undefined
          ? null
          : toNumber(state.processed_min_created_at);
      return {
        kind: "ready",
        version: toNumber(state.version, activeVersion),
        processedRows,
        processedMinCreatedAt: processedMin,
        processedMaxCreatedAt: processedMax,
      };
    }
    return {
      kind: "building",
      processedRows,
      safeMessage: formatProcessedRowsMessage(processedRows),
    };
  }

  if (buildingVersion !== null && Number.isFinite(buildingVersion)) {
    const stateResult = await client.query(
      `SELECT version, status, history_complete, processed_rows,
              processed_min_created_at, processed_max_created_at
       FROM dashboard_rollup_state
       WHERE version = $1`,
      [buildingVersion],
    );
    const state = stateResult.rows[0] as StateRow | undefined;
    if (!state) {
      return {
        kind: "initializing",
        processedRows: 0,
        safeMessage: SAFE_INITIALIZING,
      };
    }
    const processedRows = toNumber(state.processed_rows, 0);
    const status = readStateStatus(state.status);
    if (status === "unhealthy") {
      return {
        kind: "unhealthy",
        processedRows,
        safeMessage: SAFE_UNHEALTHY,
      };
    }
    return {
      kind: "building",
      processedRows,
      safeMessage: formatProcessedRowsMessage(processedRows) || SAFE_BUILDING,
    };
  }

  return {
    kind: "initializing",
    processedRows: 0,
    safeMessage: SAFE_INITIALIZING,
  };
}

function readTxOptions(config: DashboardRollupConfig): TransactionOptions {
  return {
    ...READ_TX,
    statementTimeoutMs: config.statementTimeoutMs,
  };
}

export async function getDashboardRollupReadiness(
  config: DashboardRollupConfig = getDashboardRollupConfig(),
): Promise<DashboardRollupReadiness> {
  if (!config.readsEnabled) {
    return {
      kind: "disabled",
      processedRows: 0,
      safeMessage: SAFE_DISABLED,
    };
  }

  try {
    return await withTransactionImpl(
      (client) => readDashboardRollupReadiness(client, config),
      readTxOptions(config),
    );
  } catch (error) {
    if (isPgUndefinedTable(error)) {
      return {
        kind: "initializing",
        processedRows: 0,
        safeMessage: SAFE_INITIALIZING,
      };
    }
    logSafe("readiness", error);
    return {
      kind: "unhealthy",
      processedRows: 0,
      safeMessage: SAFE_UNHEALTHY,
    };
  }
}

export function createDashboardRollupPlan(
  readiness: Extract<DashboardRollupReadiness, { kind: "ready" }>,
  filters: DashboardFilters,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): DashboardRollupQueryPlan {
  const preset: DashboardLongRangePreset =
    filters.preset === "all" ? "all" : "30d";

  if (preset === "all") {
    return {
      kind: "rollup",
      preset: "all",
      version: readiness.version,
      filters,
      startTimestamp: null,
      endTimestamp: null,
      segments: [],
    };
  }

  const watermark = getClosedDashboardWatermark(readiness.processedMaxCreatedAt, nowSeconds);
  if (watermark === null) {
    throw new RangeError("30d rollup plan requires a closed watermark from processedMaxCreatedAt");
  }
  const range = getDashboardThirtyDayRange(watermark);
  const segments = decomposeDashboardRange(range.start, range.end);
  return {
    kind: "rollup",
    preset: "30d",
    version: readiness.version,
    filters,
    startTimestamp: range.start,
    endTimestamp: range.end,
    segments,
  };
}

interface BindState {
  values: unknown[];
}

function bind(state: BindState, value: unknown): string {
  state.values.push(value);
  return `$${state.values.length}`;
}

function segmentsCte(state: BindState, segments: DashboardRollupRangeSegment[]): string {
  if (segments.length === 0) {
    throw new Error("30d plan requires non-empty segments");
  }
  const rows = segments.map((segment) => {
    const g = bind(state, segment.grain);
    const s = bind(state, segment.start);
    const e = bind(state, segment.end);
    return `(${g}::smallint, ${s}::bigint, ${e}::bigint)`;
  });
  return `segments(grain, start_ts, end_ts) AS (VALUES ${rows.join(", ")})`;
}

function appendFilterPredicates(
  state: BindState,
  filters: DashboardFilters,
  alias = "d",
): string {
  const clauses: string[] = [];
  if (filters.token) {
    const p = bind(state, `%${filters.token}%`);
    clauses.push(`${alias}.token_name ILIKE ${p}`);
  }
  if (filters.username) {
    const p = bind(state, filters.username);
    clauses.push(`${alias}.username = ${p}`);
  }
  if (filters.model) {
    const p = bind(state, filters.model);
    clauses.push(`${alias}.model_name = ${p}`);
  }
  if (filters.channelId) {
    const p = bind(state, filters.channelId);
    clauses.push(`${alias}.channel_id = ${p}`);
  }
  return clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
}

function rangeFromRollups(
  state: BindState,
  plan: DashboardRollupQueryPlan,
  options: {
    maskExpr: string;
    extraDimPredicates?: string;
  },
): { ctes: string[]; fromJoin: string } {
  const versionParam = bind(state, plan.version);
  if (plan.preset === "all") {
    const grainParam = bind(state, DASHBOARD_ROLLUP_GRAINS.all);
    return {
      ctes: [],
      fromJoin: `
        FROM dashboard_rollups r
        INNER JOIN dashboard_rollup_dimensions d
          ON d.id = r.dimension_id
         AND d.version = r.version
        WHERE r.version = ${versionParam}
          AND r.grain = ${grainParam}
          AND r.bucket_start = 0
          AND ${options.maskExpr}
          ${options.extraDimPredicates ?? ""}
      `,
    };
  }

  const cte = segmentsCte(state, plan.segments);
  return {
    ctes: [cte],
    fromJoin: `
      FROM segments s
      INNER JOIN dashboard_rollups r
        ON r.grain = s.grain
       AND r.bucket_start >= s.start_ts
       AND r.bucket_start < s.end_ts
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id
       AND d.version = r.version
      WHERE r.version = ${versionParam}
        AND ${options.maskExpr}
        ${options.extraDimPredicates ?? ""}
    `,
  };
}

function withCtes(ctes: string[], body: string): string {
  if (ctes.length === 0) return body;
  return `WITH ${ctes.join(",\n")}\n${body}`;
}

function buildSummaryQuery(plan: DashboardRollupQueryPlan): DashboardRollupNamedQuery<PacketQueryName> {
  const state: BindState = { values: [] };
  const filtered = getDashboardFilterMask(plan.filters) === 15;

  if (filtered) {
    const filterSql = appendFilterPredicates(state, plan.filters, "d");
    const maskParam = bind(state, 15);
    const { ctes, fromJoin } = rangeFromRollups(state, plan, {
      maskExpr: `d.dimension_mask = ${maskParam}`,
      extraDimPredicates: filterSql,
    });
    const text = withCtes(
      ctes,
      `
      SELECT
        COALESCE(SUM(r.request_count), 0) AS request_count,
        COALESCE(SUM(r.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(r.cache_tokens), 0) AS cache_tokens,
        COALESCE(SUM(r.output_tokens_per_sec_sum), 0) AS output_tokens_per_sec_sum,
        COALESCE(SUM(r.output_tokens_per_sec_count), 0) AS output_tokens_per_sec_count,
        COUNT(DISTINCT d.user_id) FILTER (WHERE d.user_id IS NOT NULL) AS active_user_count,
        COUNT(DISTINCT d.channel_id) FILTER (WHERE d.channel_id IS NOT NULL) AS active_channel_count,
        COALESCE(SUM(r.attempt_count), 0) AS total_attempts,
        COALESCE(SUM(r.success_count), 0) AS success_count,
        COALESCE(SUM(r.error_count), 0) AS error_count,
        COALESCE(SUM(r.first_token_latency_sum), 0) AS first_token_latency_sum,
        COALESCE(SUM(r.first_token_latency_count), 0) AS first_token_latency_count,
        COALESCE(SUM(r.response_time_sum), 0) AS response_time_sum,
        COALESCE(SUM(r.response_time_count), 0) AS response_time_count
      ${fromJoin}
      `.trim(),
    );
    return { name: "summary", text, values: state.values };
  }

  // Unfiltered: mask0 totals + mask2 users + mask8 channels in one statement.
  if (plan.preset === "all") {
    const versionParam = bind(state, plan.version);
    const grainAll = bind(state, DASHBOARD_ROLLUP_GRAINS.all);
    const mask0 = bind(state, 0);
    const mask2 = bind(state, 2);
    const mask8 = bind(state, 8);
    const text = `
      SELECT
        COALESCE((
          SELECT SUM(r.request_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS request_count,
        COALESCE((
          SELECT SUM(r.input_tokens)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS input_tokens,
        COALESCE((
          SELECT SUM(r.output_tokens)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS output_tokens,
        COALESCE((
          SELECT SUM(r.cache_tokens)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS cache_tokens,
        COALESCE((
          SELECT SUM(r.output_tokens_per_sec_sum)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS output_tokens_per_sec_sum,
        COALESCE((
          SELECT SUM(r.output_tokens_per_sec_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS output_tokens_per_sec_count,
        COALESCE((
          SELECT COUNT(DISTINCT d.user_id)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask2}
            AND d.user_id IS NOT NULL
        ), 0) AS active_user_count,
        COALESCE((
          SELECT COUNT(DISTINCT d.channel_id)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask8}
            AND d.channel_id IS NOT NULL
        ), 0) AS active_channel_count,
        COALESCE((
          SELECT SUM(r.attempt_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS total_attempts,
        COALESCE((
          SELECT SUM(r.success_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS success_count,
        COALESCE((
          SELECT SUM(r.error_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS error_count,
        COALESCE((
          SELECT SUM(r.first_token_latency_sum)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS first_token_latency_sum,
        COALESCE((
          SELECT SUM(r.first_token_latency_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS first_token_latency_count,
        COALESCE((
          SELECT SUM(r.response_time_sum)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS response_time_sum,
        COALESCE((
          SELECT SUM(r.response_time_count)
          FROM dashboard_rollups r
          INNER JOIN dashboard_rollup_dimensions d ON d.id = r.dimension_id AND d.version = r.version
          WHERE r.version = ${versionParam} AND r.grain = ${grainAll} AND r.bucket_start = 0
            AND d.dimension_mask = ${mask0}
        ), 0) AS response_time_count
    `.trim();
    return { name: "summary", text, values: state.values };
  }

  // Unfiltered 30d via segments CTE once, aggregate with FILTER by mask.
  const versionParam = bind(state, plan.version);
  const mask0 = bind(state, 0);
  const mask2 = bind(state, 2);
  const mask8 = bind(state, 8);
  const cte = segmentsCte(state, plan.segments);
  const text = withCtes(
    [cte],
    `
    SELECT
      COALESCE(SUM(r.request_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS request_count,
      COALESCE(SUM(r.input_tokens) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS input_tokens,
      COALESCE(SUM(r.output_tokens) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS output_tokens,
      COALESCE(SUM(r.cache_tokens) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS cache_tokens,
      COALESCE(SUM(r.output_tokens_per_sec_sum) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS output_tokens_per_sec_sum,
      COALESCE(SUM(r.output_tokens_per_sec_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS output_tokens_per_sec_count,
      COUNT(DISTINCT d.user_id) FILTER (WHERE d.dimension_mask = ${mask2} AND d.user_id IS NOT NULL) AS active_user_count,
      COUNT(DISTINCT d.channel_id) FILTER (WHERE d.dimension_mask = ${mask8} AND d.channel_id IS NOT NULL) AS active_channel_count,
      COALESCE(SUM(r.attempt_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS total_attempts,
      COALESCE(SUM(r.success_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS success_count,
      COALESCE(SUM(r.error_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS error_count,
      COALESCE(SUM(r.first_token_latency_sum) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS first_token_latency_sum,
      COALESCE(SUM(r.first_token_latency_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS first_token_latency_count,
      COALESCE(SUM(r.response_time_sum) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS response_time_sum,
      COALESCE(SUM(r.response_time_count) FILTER (WHERE d.dimension_mask = ${mask0}), 0) AS response_time_count
    FROM segments s
    INNER JOIN dashboard_rollups r
      ON r.grain = s.grain
     AND r.bucket_start >= s.start_ts
     AND r.bucket_start < s.end_ts
    INNER JOIN dashboard_rollup_dimensions d
      ON d.id = r.dimension_id
     AND d.version = r.version
    WHERE r.version = ${versionParam}
      AND d.dimension_mask IN (${mask0}, ${mask2}, ${mask8})
    `.trim(),
  );
  return { name: "summary", text, values: state.values };
}

function buildRankingsQuery(plan: DashboardRollupQueryPlan): DashboardRollupNamedQuery<PacketQueryName> {
  const filtered = getDashboardFilterMask(plan.filters) === 15;
  const shared: BindState = { values: [] };
  const sharedVersion = bind(shared, plan.version);
  const sharedFilterSql = filtered ? appendFilterPredicates(shared, plan.filters, "d") : "";
  const mTok = bind(shared, filtered ? 15 : 1);
  const mUser = bind(shared, filtered ? 15 : 2);
  const mModel = bind(shared, filtered ? 15 : 4);
  const mChan = bind(shared, filtered ? 15 : 8);

  let sharedCtes: string[] = [];
  let rollupJoin: string;
  if (plan.preset === "all") {
    const gAll = bind(shared, DASHBOARD_ROLLUP_GRAINS.all);
    rollupJoin = `
      dashboard_rollups r
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id AND d.version = r.version
      WHERE r.version = ${sharedVersion}
        AND r.grain = ${gAll}
        AND r.bucket_start = 0
        ${sharedFilterSql}
    `;
  } else {
    sharedCtes = [segmentsCte(shared, plan.segments)];
    rollupJoin = `
      segments s
      INNER JOIN dashboard_rollups r
        ON r.grain = s.grain
       AND r.bucket_start >= s.start_ts
       AND r.bucket_start < s.end_ts
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id AND d.version = r.version
      WHERE r.version = ${sharedVersion}
        ${sharedFilterSql}
    `;
  }

  const text = withCtes(
    sharedCtes,
    `
    (
      WITH base AS (
        SELECT
          COALESCE(d.token_id, 0) AS token_id,
          COALESCE(NULLIF(d.token_name, ''), 'Unknown') AS log_token_name,
          MAX(r.representative_user_id) AS rep_user_id,
          MAX(r.representative_username) AS rep_username,
          SUM(r.request_count) AS request_count,
          SUM(r.input_tokens) AS input_tokens,
          SUM(r.output_tokens) AS output_tokens,
          SUM(r.cache_tokens) AS cache_tokens,
          MAX(r.latest_used_at) AS latest_used_at
        FROM ${rollupJoin}
          AND d.dimension_mask = ${mTok}
        GROUP BY COALESCE(d.token_id, 0), COALESCE(NULLIF(d.token_name, ''), 'Unknown')
      )
      SELECT
        'token'::text AS dimension_kind,
        base.token_id,
        COALESCE(NULLIF(tokens.name, ''), base.log_token_name) AS token_name,
        COALESCE(users.username, base.rep_username, 'Unknown') AS username,
        COALESCE(users.display_name, '') AS display_name,
        COALESCE(tokens.status, -1) AS status,
        COALESCE(tokens.expired_time, -1) AS expired_time,
        NULL::bigint AS user_id,
        NULL::text AS model_name,
        NULL::bigint AS channel_id,
        NULL::text AS channel_name,
        NULL::integer AS type,
        base.request_count,
        base.input_tokens,
        base.output_tokens,
        (base.input_tokens + base.output_tokens) AS total_tokens,
        base.cache_tokens,
        NULL::double precision AS output_tokens_per_sec,
        base.latest_used_at,
        NULL::bigint AS total_attempts,
        NULL::bigint AS success_count,
        NULL::bigint AS error_count,
        NULL::double precision AS error_rate,
        NULL::double precision AS avg_first_token_latency,
        NULL::double precision AS avg_total_response_time,
        NULL::double precision AS avg_output_tokens_per_sec
      FROM base
      LEFT JOIN tokens ON tokens.id = base.token_id
      LEFT JOIN users ON users.id = COALESCE(tokens.user_id, base.rep_user_id)
      ORDER BY total_tokens DESC, request_count DESC
      LIMIT 20
    )
    UNION ALL
    (
      WITH base AS (
        SELECT
          COALESCE(d.user_id, 0) AS user_id,
          COALESCE(NULLIF(d.username, ''), 'Unknown') AS log_username,
          SUM(r.request_count) AS request_count,
          SUM(r.input_tokens) AS input_tokens,
          SUM(r.output_tokens) AS output_tokens,
          SUM(r.cache_tokens) AS cache_tokens,
          MAX(r.latest_used_at) AS latest_used_at
        FROM ${rollupJoin}
          AND d.dimension_mask = ${mUser}
        GROUP BY COALESCE(d.user_id, 0), COALESCE(NULLIF(d.username, ''), 'Unknown')
      )
      SELECT
        'user'::text AS dimension_kind,
        NULL::bigint AS token_id,
        NULL::text AS token_name,
        COALESCE(users.username, base.log_username, 'Unknown') AS username,
        COALESCE(users.display_name, '') AS display_name,
        COALESCE(users.status, -1) AS status,
        NULL::bigint AS expired_time,
        base.user_id,
        NULL::text AS model_name,
        NULL::bigint AS channel_id,
        NULL::text AS channel_name,
        NULL::integer AS type,
        base.request_count,
        base.input_tokens,
        base.output_tokens,
        (base.input_tokens + base.output_tokens) AS total_tokens,
        base.cache_tokens,
        NULL::double precision AS output_tokens_per_sec,
        base.latest_used_at,
        NULL::bigint AS total_attempts,
        NULL::bigint AS success_count,
        NULL::bigint AS error_count,
        NULL::double precision AS error_rate,
        NULL::double precision AS avg_first_token_latency,
        NULL::double precision AS avg_total_response_time,
        NULL::double precision AS avg_output_tokens_per_sec
      FROM base
      LEFT JOIN users ON users.id = base.user_id
      ORDER BY total_tokens DESC, request_count DESC
      LIMIT 12
    )
    UNION ALL
    (
      WITH base AS (
        SELECT
          COALESCE(NULLIF(d.model_name, ''), 'Unknown') AS model_name,
          SUM(r.request_count) AS request_count,
          SUM(r.input_tokens) AS input_tokens,
          SUM(r.output_tokens) AS output_tokens,
          SUM(r.cache_tokens) AS cache_tokens,
          SUM(r.output_tokens_per_sec_sum) AS output_tokens_per_sec_sum,
          SUM(r.output_tokens_per_sec_count) AS output_tokens_per_sec_count,
          MAX(r.latest_used_at) AS latest_used_at
        FROM ${rollupJoin}
          AND d.dimension_mask = ${mModel}
        GROUP BY COALESCE(NULLIF(d.model_name, ''), 'Unknown')
      )
      SELECT
        'model'::text AS dimension_kind,
        NULL::bigint AS token_id,
        NULL::text AS token_name,
        NULL::text AS username,
        NULL::text AS display_name,
        NULL::integer AS status,
        NULL::bigint AS expired_time,
        NULL::bigint AS user_id,
        base.model_name,
        NULL::bigint AS channel_id,
        NULL::text AS channel_name,
        NULL::integer AS type,
        base.request_count,
        base.input_tokens,
        base.output_tokens,
        (base.input_tokens + base.output_tokens) AS total_tokens,
        base.cache_tokens,
        CASE WHEN base.output_tokens_per_sec_count > 0
          THEN base.output_tokens_per_sec_sum / base.output_tokens_per_sec_count
          ELSE NULL
        END AS output_tokens_per_sec,
        base.latest_used_at,
        NULL::bigint AS total_attempts,
        NULL::bigint AS success_count,
        NULL::bigint AS error_count,
        NULL::double precision AS error_rate,
        NULL::double precision AS avg_first_token_latency,
        NULL::double precision AS avg_total_response_time,
        NULL::double precision AS avg_output_tokens_per_sec
      FROM base
      ORDER BY total_tokens DESC, request_count DESC
      LIMIT 12
    )
    UNION ALL
    (
      WITH base AS (
        SELECT
          COALESCE(d.channel_id, 0) AS channel_id,
          MAX(r.representative_channel_name) AS log_channel_name,
          SUM(r.request_count) AS request_count,
          SUM(r.input_tokens) AS input_tokens,
          SUM(r.output_tokens) AS output_tokens,
          SUM(r.cache_tokens) AS cache_tokens,
          SUM(r.output_tokens_per_sec_sum) AS output_tokens_per_sec_sum,
          SUM(r.output_tokens_per_sec_count) AS output_tokens_per_sec_count,
          MAX(r.latest_used_at) AS latest_used_at
        FROM ${rollupJoin}
          AND d.dimension_mask = ${mChan}
        GROUP BY COALESCE(d.channel_id, 0)
      )
      SELECT
        'channel'::text AS dimension_kind,
        NULL::bigint AS token_id,
        NULL::text AS token_name,
        NULL::text AS username,
        NULL::text AS display_name,
        COALESCE(channels.status, -1) AS status,
        NULL::bigint AS expired_time,
        NULL::bigint AS user_id,
        NULL::text AS model_name,
        base.channel_id,
        COALESCE(NULLIF(channels.name, ''), base.log_channel_name, CONCAT('渠道 ', base.channel_id::text)) AS channel_name,
        COALESCE(channels.type, -1) AS type,
        base.request_count,
        base.input_tokens,
        base.output_tokens,
        (base.input_tokens + base.output_tokens) AS total_tokens,
        base.cache_tokens,
        CASE WHEN base.output_tokens_per_sec_count > 0
          THEN base.output_tokens_per_sec_sum / base.output_tokens_per_sec_count
          ELSE NULL
        END AS output_tokens_per_sec,
        base.latest_used_at,
        NULL::bigint AS total_attempts,
        NULL::bigint AS success_count,
        NULL::bigint AS error_count,
        NULL::double precision AS error_rate,
        NULL::double precision AS avg_first_token_latency,
        NULL::double precision AS avg_total_response_time,
        NULL::double precision AS avg_output_tokens_per_sec
      FROM base
      LEFT JOIN channels ON channels.id = base.channel_id
      ORDER BY total_tokens DESC, request_count DESC
      LIMIT 12
    )
    `.trim(),
  );

  return { name: "rankings", text, values: shared.values };
}

function buildStabilityQuery(plan: DashboardRollupQueryPlan): DashboardRollupNamedQuery<PacketQueryName> {
  const state: BindState = { values: [] };
  const filtered = getDashboardFilterMask(plan.filters) === 15;
  const filterSql = filtered ? appendFilterPredicates(state, plan.filters, "d") : "";
  const versionParam = bind(state, plan.version);
  const mModel = bind(state, filtered ? 15 : 4);
  const mChan = bind(state, filtered ? 15 : 8);

  let ctes: string[] = [];
  let rollupJoin: string;
  if (plan.preset === "all") {
    const gAll = bind(state, DASHBOARD_ROLLUP_GRAINS.all);
    rollupJoin = `
      dashboard_rollups r
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id AND d.version = r.version
      WHERE r.version = ${versionParam}
        AND r.grain = ${gAll}
        AND r.bucket_start = 0
        ${filterSql}
    `;
  } else {
    ctes = [segmentsCte(state, plan.segments)];
    rollupJoin = `
      segments s
      INNER JOIN dashboard_rollups r
        ON r.grain = s.grain
       AND r.bucket_start >= s.start_ts
       AND r.bucket_start < s.end_ts
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id AND d.version = r.version
      WHERE r.version = ${versionParam}
        ${filterSql}
    `;
  }

  const text = withCtes(
    ctes,
    `
    (
      WITH base AS (
        SELECT
          COALESCE(NULLIF(d.model_name, ''), 'Unknown') AS model_name,
          SUM(r.attempt_count) AS total_attempts,
          SUM(r.success_count) AS success_count,
          SUM(r.error_count) AS error_count,
          SUM(r.first_token_latency_sum) AS first_token_latency_sum,
          SUM(r.first_token_latency_count) AS first_token_latency_count,
          SUM(r.response_time_sum) AS response_time_sum,
          SUM(r.response_time_count) AS response_time_count,
          SUM(r.output_tokens_per_sec_sum) AS output_tokens_per_sec_sum,
          SUM(r.output_tokens_per_sec_count) AS output_tokens_per_sec_count,
          MAX(r.latest_used_at) AS latest_used_at
        FROM ${rollupJoin}
          AND d.dimension_mask = ${mModel}
        GROUP BY COALESCE(NULLIF(d.model_name, ''), 'Unknown')
      )
      SELECT
        'model'::text AS dimension_kind,
        base.model_name,
        NULL::bigint AS channel_id,
        NULL::text AS channel_name,
        NULL::integer AS type,
        NULL::integer AS status,
        base.total_attempts,
        base.success_count,
        base.error_count,
        CASE WHEN base.total_attempts > 0
          THEN base.error_count::double precision / base.total_attempts
          ELSE NULL
        END AS error_rate,
        CASE WHEN base.first_token_latency_count > 0
          THEN base.first_token_latency_sum / base.first_token_latency_count
          ELSE NULL
        END AS avg_first_token_latency,
        CASE WHEN base.response_time_count > 0
          THEN base.response_time_sum / base.response_time_count
          ELSE NULL
        END AS avg_total_response_time,
        CASE WHEN base.output_tokens_per_sec_count > 0
          THEN base.output_tokens_per_sec_sum / base.output_tokens_per_sec_count
          ELSE NULL
        END AS avg_output_tokens_per_sec,
        base.latest_used_at
      FROM base
      WHERE base.total_attempts > 0
      ORDER BY error_rate DESC NULLS LAST, total_attempts DESC, latest_used_at DESC
      LIMIT 12
    )
    UNION ALL
    (
      WITH base AS (
        SELECT
          COALESCE(d.channel_id, 0) AS channel_id,
          MAX(r.representative_channel_name) AS log_channel_name,
          SUM(r.attempt_count) AS total_attempts,
          SUM(r.success_count) AS success_count,
          SUM(r.error_count) AS error_count,
          SUM(r.first_token_latency_sum) AS first_token_latency_sum,
          SUM(r.first_token_latency_count) AS first_token_latency_count,
          SUM(r.response_time_sum) AS response_time_sum,
          SUM(r.response_time_count) AS response_time_count,
          SUM(r.output_tokens_per_sec_sum) AS output_tokens_per_sec_sum,
          SUM(r.output_tokens_per_sec_count) AS output_tokens_per_sec_count,
          MAX(r.latest_used_at) AS latest_used_at
        FROM ${rollupJoin}
          AND d.dimension_mask = ${mChan}
        GROUP BY COALESCE(d.channel_id, 0)
      )
      SELECT
        'channel'::text AS dimension_kind,
        NULL::text AS model_name,
        base.channel_id,
        COALESCE(NULLIF(channels.name, ''), base.log_channel_name, CONCAT('渠道 ', base.channel_id::text)) AS channel_name,
        COALESCE(channels.type, -1) AS type,
        COALESCE(channels.status, -1) AS status,
        base.total_attempts,
        base.success_count,
        base.error_count,
        CASE WHEN base.total_attempts > 0
          THEN base.error_count::double precision / base.total_attempts
          ELSE NULL
        END AS error_rate,
        CASE WHEN base.first_token_latency_count > 0
          THEN base.first_token_latency_sum / base.first_token_latency_count
          ELSE NULL
        END AS avg_first_token_latency,
        CASE WHEN base.response_time_count > 0
          THEN base.response_time_sum / base.response_time_count
          ELSE NULL
        END AS avg_total_response_time,
        CASE WHEN base.output_tokens_per_sec_count > 0
          THEN base.output_tokens_per_sec_sum / base.output_tokens_per_sec_count
          ELSE NULL
        END AS avg_output_tokens_per_sec,
        base.latest_used_at
      FROM base
      LEFT JOIN channels ON channels.id = base.channel_id
      WHERE base.total_attempts > 0
      ORDER BY error_rate DESC NULLS LAST, total_attempts DESC, latest_used_at DESC
      LIMIT 12
    )
    `.trim(),
  );
  return { name: "stability", text, values: state.values };
}

function buildTrendQuery(plan: DashboardRollupQueryPlan): DashboardRollupNamedQuery<PacketQueryName> {
  const state: BindState = { values: [] };
  const filtered = getDashboardFilterMask(plan.filters) === 15;
  const filterSql = filtered ? appendFilterPredicates(state, plan.filters, "d") : "";
  const versionParam = bind(state, plan.version);
  const maskParam = bind(state, filtered ? 15 : 0);

  if (plan.preset === "all") {
    const grainDay = bind(state, DASHBOARD_ROLLUP_GRAINS.day);
    const text = `
      SELECT
        r.bucket_start AS bucket_ts,
        COALESCE(SUM(r.request_count), 0) AS request_count,
        COALESCE(SUM(r.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(r.cache_tokens), 0) AS cache_tokens
      FROM dashboard_rollups r
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id AND d.version = r.version
      WHERE r.version = ${versionParam}
        AND r.grain = ${grainDay}
        AND d.dimension_mask = ${maskParam}
        ${filterSql}
      GROUP BY r.bucket_start
      ORDER BY r.bucket_start ASC
    `.trim();
    return { name: "trend", text, values: state.values };
  }

  const cte = segmentsCte(state, plan.segments);
  const text = withCtes(
    [cte],
    `
    SELECT
      (FLOOR((r.bucket_start + 28800)::numeric / 86400) * 86400 - 28800)::bigint AS bucket_ts,
      COALESCE(SUM(r.request_count), 0) AS request_count,
      COALESCE(SUM(r.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(r.cache_tokens), 0) AS cache_tokens
    FROM segments s
    INNER JOIN dashboard_rollups r
      ON r.grain = s.grain
     AND r.bucket_start >= s.start_ts
     AND r.bucket_start < s.end_ts
    INNER JOIN dashboard_rollup_dimensions d
      ON d.id = r.dimension_id AND d.version = r.version
    WHERE r.version = ${versionParam}
      AND d.dimension_mask = ${maskParam}
      ${filterSql}
    GROUP BY 1
    ORDER BY 1 ASC
    `.trim(),
  );
  return { name: "trend", text, values: state.values };
}

export function buildDashboardRollupPacketQueries(
  plan: DashboardRollupQueryPlan,
): Array<{ name: PacketQueryName; text: string; values: unknown[] }> {
  return [
    buildSummaryQuery(plan),
    buildRankingsQuery(plan),
    buildStabilityQuery(plan),
    buildTrendQuery(plan),
  ];
}

function mapSummaryRow(row: Record<string, unknown> | undefined): {
  summary: SummaryMetrics;
  stabilitySummary: StabilitySummary;
} {
  const requestCount = toNumber(row?.request_count);
  const inputTokens = toNumber(row?.input_tokens);
  const outputTokens = toNumber(row?.output_tokens);
  const totalAttempts = toNumber(row?.total_attempts);
  const errorCount = toNumber(row?.error_count);
  return {
    summary: {
      requestCount,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheTokens: toNumber(row?.cache_tokens),
      avgOutputTokensPerSec: divideNullable(
        row?.output_tokens_per_sec_sum,
        row?.output_tokens_per_sec_count,
      ),
      activeUserCount: toNumber(row?.active_user_count),
      activeChannelCount: toNumber(row?.active_channel_count),
    },
    stabilitySummary: {
      totalAttempts,
      successCount: toNumber(row?.success_count),
      errorCount,
      errorRate: totalAttempts > 0 ? errorCount / totalAttempts : null,
      avgFirstTokenLatency: divideNullable(
        row?.first_token_latency_sum,
        row?.first_token_latency_count,
      ),
      avgTotalResponseTime: divideNullable(row?.response_time_sum, row?.response_time_count),
    },
  };
}

function mapRankings(rows: Record<string, unknown>[]): {
  tokenRankings: TokenRankingRow[];
  userRankings: UserRankingRow[];
  modelRankings: ModelRankingRow[];
  channelRankings: ChannelRankingRow[];
} {
  const tokenRankings: TokenRankingRow[] = [];
  const userRankings: UserRankingRow[] = [];
  const modelRankings: ModelRankingRow[] = [];
  const channelRankings: ChannelRankingRow[] = [];

  for (const row of rows) {
    const kind = String(row.dimension_kind ?? "");
    if (kind === "token") {
      tokenRankings.push({
        tokenId: toNumber(row.token_id),
        tokenName: String(row.token_name ?? ""),
        username: String(row.username ?? ""),
        displayName: String(row.display_name ?? ""),
        status: toNumber(row.status, -1),
        expiredTime: toNumber(row.expired_time, -1),
        requestCount: toNumber(row.request_count),
        inputTokens: toNumber(row.input_tokens),
        outputTokens: toNumber(row.output_tokens),
        totalTokens: toNumber(row.total_tokens, toNumber(row.input_tokens) + toNumber(row.output_tokens)),
        cacheTokens: toNumber(row.cache_tokens),
        outputTokensPerSec: null,
        latestUsedAt: toNumber(row.latest_used_at),
      });
    } else if (kind === "user") {
      userRankings.push({
        userId: toNumber(row.user_id),
        username: String(row.username ?? ""),
        displayName: String(row.display_name ?? ""),
        status: toNumber(row.status, -1),
        requestCount: toNumber(row.request_count),
        inputTokens: toNumber(row.input_tokens),
        outputTokens: toNumber(row.output_tokens),
        totalTokens: toNumber(row.total_tokens, toNumber(row.input_tokens) + toNumber(row.output_tokens)),
        cacheTokens: toNumber(row.cache_tokens),
        outputTokensPerSec: null,
        latestUsedAt: toNumber(row.latest_used_at),
      });
    } else if (kind === "model") {
      modelRankings.push({
        modelName: String(row.model_name ?? ""),
        requestCount: toNumber(row.request_count),
        inputTokens: toNumber(row.input_tokens),
        outputTokens: toNumber(row.output_tokens),
        totalTokens: toNumber(row.total_tokens, toNumber(row.input_tokens) + toNumber(row.output_tokens)),
        cacheTokens: toNumber(row.cache_tokens),
        outputTokensPerSec: getNullableNumber(row.output_tokens_per_sec),
        latestUsedAt: toNumber(row.latest_used_at),
      });
    } else if (kind === "channel") {
      channelRankings.push({
        channelId: toNumber(row.channel_id),
        channelName: String(row.channel_name ?? ""),
        type: toNumber(row.type, -1),
        status: toNumber(row.status, -1),
        requestCount: toNumber(row.request_count),
        inputTokens: toNumber(row.input_tokens),
        outputTokens: toNumber(row.output_tokens),
        totalTokens: toNumber(row.total_tokens, toNumber(row.input_tokens) + toNumber(row.output_tokens)),
        cacheTokens: toNumber(row.cache_tokens),
        outputTokensPerSec: getNullableNumber(row.output_tokens_per_sec),
        latestUsedAt: toNumber(row.latest_used_at),
      });
    }
  }

  return { tokenRankings, userRankings, modelRankings, channelRankings };
}

function mapStability(rows: Record<string, unknown>[]): {
  modelStability: ModelStabilityRow[];
  channelStability: ChannelStabilityRow[];
} {
  const modelStability: ModelStabilityRow[] = [];
  const channelStability: ChannelStabilityRow[] = [];
  for (const row of rows) {
    const kind = String(row.dimension_kind ?? "");
    if (kind === "model") {
      modelStability.push({
        modelName: String(row.model_name ?? ""),
        totalAttempts: toNumber(row.total_attempts),
        successCount: toNumber(row.success_count),
        errorCount: toNumber(row.error_count),
        errorRate: toNumber(row.error_rate),
        avgFirstTokenLatency: getNullableNumber(row.avg_first_token_latency),
        avgTotalResponseTime: getNullableNumber(row.avg_total_response_time),
        avgOutputTokensPerSec: getNullableNumber(row.avg_output_tokens_per_sec),
        latestUsedAt: toNumber(row.latest_used_at),
      });
    } else if (kind === "channel") {
      channelStability.push({
        channelId: toNumber(row.channel_id),
        channelName: String(row.channel_name ?? ""),
        type: toNumber(row.type, -1),
        status: toNumber(row.status, -1),
        totalAttempts: toNumber(row.total_attempts),
        successCount: toNumber(row.success_count),
        errorCount: toNumber(row.error_count),
        errorRate: toNumber(row.error_rate),
        avgFirstTokenLatency: getNullableNumber(row.avg_first_token_latency),
        avgTotalResponseTime: getNullableNumber(row.avg_total_response_time),
        avgOutputTokensPerSec: getNullableNumber(row.avg_output_tokens_per_sec),
        latestUsedAt: toNumber(row.latest_used_at),
      });
    }
  }
  return { modelStability, channelStability };
}

function mapTrend(rows: Record<string, unknown>[]): TrendPoint[] {
  return rows
    .map((row) => {
      const inputTokens = toNumber(row.input_tokens);
      const outputTokens = toNumber(row.output_tokens);
      return {
        bucketTs: toNumber(row.bucket_ts),
        requestCount: toNumber(row.request_count),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cacheTokens: toNumber(row.cache_tokens),
      };
    })
    .sort((a, b) => a.bucketTs - b.bucketTs);
}

export async function executeDashboardRollupPacket(
  client: DbClient,
  plan: DashboardRollupQueryPlan,
): Promise<DashboardRollupPacket> {
  const queries = buildDashboardRollupPacketQueries(plan);
  const results: Record<string, Record<string, unknown>[]> = {};
  for (const q of queries) {
    const result = await client.query(q.text, q.values);
    results[q.name] = result.rows as Record<string, unknown>[];
  }

  const { summary, stabilitySummary } = mapSummaryRow(results.summary?.[0]);
  const rankings = mapRankings(results.rankings ?? []);
  const stability = mapStability(results.stability ?? []);
  const trend = mapTrend(results.trend ?? []);

  return {
    summary,
    stabilitySummary,
    ...rankings,
    ...stability,
    trend,
    granularity: "day",
  };
}

export async function getDashboardRollupPacket(
  plan: DashboardRollupQueryPlan,
  config: DashboardRollupConfig = getDashboardRollupConfig(),
): Promise<DashboardRollupPacketResult> {
  try {
    const data = await withTransactionImpl(
      (client) => executeDashboardRollupPacket(client, plan),
      readTxOptions(config),
    );
    return { kind: "ready", data };
  } catch (error) {
    logSafe("packet", error);
    return { kind: "error", safeMessage: SAFE_PACKET_ERROR };
  }
}

export function buildDashboardRollupModelOptionsQuery(version: number): {
  text: string;
  values: unknown[];
} {
  return {
    text: `
      SELECT DISTINCT d.model_name AS value, d.model_name AS label
      FROM dashboard_rollup_dimensions d
      WHERE d.version = $1
        AND d.dimension_mask IN (4, 15)
        AND d.model_name IS NOT NULL
        AND d.model_name <> ''
        AND d.model_name <> 'Unknown'
      ORDER BY d.model_name ASC
    `.trim(),
    values: [version],
  };
}

export async function getDashboardRollupModelOptions(
  version: number,
  config: DashboardRollupConfig = getDashboardRollupConfig(),
): Promise<Array<{ value: string; label: string }>> {
  try {
    return await withTransactionImpl(async (client) => {
      const q = buildDashboardRollupModelOptionsQuery(version);
      const result = await client.query(q.text, q.values);
      return (result.rows as Array<{ value: unknown; label: unknown }>).map((row) => ({
        value: String(row.value ?? ""),
        label: String(row.label ?? row.value ?? ""),
      }));
    }, readTxOptions(config));
  } catch (error) {
    logSafe("model-options", error);
    return [];
  }
}

function tokenMatchPredicates(
  state: BindState,
  token: { tokenId: number; tokenName: string },
): string {
  const idParam = bind(state, token.tokenId);
  if (token.tokenId === 0) {
    const nameParam = bind(state, token.tokenName);
    return `COALESCE(d.token_id, 0) = ${idParam} AND COALESCE(NULLIF(d.token_name, ''), 'Unknown') = ${nameParam}`;
  }
  return `COALESCE(d.token_id, 0) = ${idParam}`;
}

function detailRangeJoin(
  state: BindState,
  plan: DashboardRollupQueryPlan,
  token: { tokenId: number; tokenName: string },
  options?: { includeChannelsJoin?: boolean },
): { ctes: string[]; fromJoin: string } {
  const filterSql = appendFilterPredicates(state, plan.filters, "d");
  const versionParam = bind(state, plan.version);
  const maskParam = bind(state, 15);
  const tokenPred = tokenMatchPredicates(state, token);
  const channelsJoin = options?.includeChannelsJoin
    ? `LEFT JOIN channels ON channels.id = d.channel_id`
    : "";

  if (plan.preset === "all") {
    const grainParam = bind(state, DASHBOARD_ROLLUP_GRAINS.all);
    return {
      ctes: [],
      fromJoin: `
        FROM dashboard_rollups r
        INNER JOIN dashboard_rollup_dimensions d
          ON d.id = r.dimension_id AND d.version = r.version
        ${channelsJoin}
        WHERE r.version = ${versionParam}
          AND r.grain = ${grainParam}
          AND r.bucket_start = 0
          AND d.dimension_mask = ${maskParam}
          AND ${tokenPred}
          ${filterSql}
      `,
    };
  }

  const cte = segmentsCte(state, plan.segments);
  return {
    ctes: [cte],
    fromJoin: `
      FROM segments s
      INNER JOIN dashboard_rollups r
        ON r.grain = s.grain
       AND r.bucket_start >= s.start_ts
       AND r.bucket_start < s.end_ts
      INNER JOIN dashboard_rollup_dimensions d
        ON d.id = r.dimension_id AND d.version = r.version
      ${channelsJoin}
      WHERE r.version = ${versionParam}
        AND d.dimension_mask = ${maskParam}
        AND ${tokenPred}
        ${filterSql}
    `,
  };
}

export function buildDashboardRollupTokenDetailQueries(
  plan: DashboardRollupQueryPlan,
  token: { tokenId: number; tokenName: string },
): Array<{ name: DetailQueryName; text: string; values: unknown[] }> {
  // summary
  const summaryState: BindState = { values: [] };
  const summaryRange = detailRangeJoin(summaryState, plan, token);
  const summaryText = withCtes(
    summaryRange.ctes,
    `
    SELECT
      COALESCE(MIN(r.first_used_at), 0) AS first_used_at,
      COUNT(DISTINCT d.model_name) FILTER (
        WHERE d.model_name IS NOT NULL AND d.model_name <> '' AND d.model_name <> 'Unknown'
      ) AS active_model_count,
      COUNT(DISTINCT d.channel_id) FILTER (WHERE d.channel_id IS NOT NULL AND d.channel_id <> 0) AS active_channel_count
    ${summaryRange.fromJoin}
    `.trim(),
  );

  // models
  const modelsState: BindState = { values: [] };
  const modelsRange = detailRangeJoin(modelsState, plan, token);
  const modelsText = withCtes(
    modelsRange.ctes,
    `
    SELECT
      d.model_name AS model_name,
      SUM(r.request_count) AS request_count,
      SUM(r.input_tokens) AS input_tokens,
      SUM(r.output_tokens) AS output_tokens,
      SUM(r.input_tokens + r.output_tokens) AS total_tokens,
      SUM(r.cache_tokens) AS cache_tokens,
      MAX(r.latest_used_at) AS latest_used_at
    ${modelsRange.fromJoin}
      AND d.model_name IS NOT NULL
      AND d.model_name <> ''
      AND d.model_name <> 'Unknown'
    GROUP BY d.model_name
    ORDER BY total_tokens DESC, request_count DESC
    LIMIT 6
    `.trim(),
  );

  // channels
  const channelsState: BindState = { values: [] };
  const channelsRange = detailRangeJoin(channelsState, plan, token, {
    includeChannelsJoin: true,
  });
  const channelsText = withCtes(
    channelsRange.ctes,
    `
    SELECT
      COALESCE(d.channel_id, 0) AS channel_id,
      COALESCE(
        NULLIF(channels.name, ''),
        MAX(r.representative_channel_name),
        CONCAT('渠道 ', COALESCE(d.channel_id, 0)::text)
      ) AS channel_name,
      SUM(r.request_count) AS request_count,
      SUM(r.input_tokens) AS input_tokens,
      SUM(r.output_tokens) AS output_tokens,
      SUM(r.input_tokens + r.output_tokens) AS total_tokens,
      SUM(r.cache_tokens) AS cache_tokens,
      MAX(r.latest_used_at) AS latest_used_at
    ${channelsRange.fromJoin}
      AND d.channel_id IS NOT NULL
      AND d.channel_id <> 0
    GROUP BY COALESCE(d.channel_id, 0), channels.name
    ORDER BY total_tokens DESC, request_count DESC
    LIMIT 6
    `.trim(),
  );

  return [
    { name: "summary", text: summaryText, values: summaryState.values },
    { name: "models", text: modelsText, values: modelsState.values },
    { name: "channels", text: channelsText, values: channelsState.values },
  ];
}

export async function executeDashboardRollupTokenDetail(
  client: DbClient,
  plan: DashboardRollupQueryPlan,
  token: { tokenId: number; tokenName: string },
): Promise<TokenDetailData> {
  const queries = buildDashboardRollupTokenDetailQueries(plan, token);
  const byName: Record<string, Record<string, unknown>[]> = {};
  for (const q of queries) {
    const result = await client.query(q.text, q.values);
    byName[q.name] = result.rows as Record<string, unknown>[];
  }
  const summary = byName.summary?.[0];
  return {
    firstUsedAt: toNumber(summary?.first_used_at),
    activeModelCount: toNumber(summary?.active_model_count),
    activeChannelCount: toNumber(summary?.active_channel_count),
    models: (byName.models ?? []).map((row) => ({
      modelName: String(row.model_name ?? ""),
      requestCount: toNumber(row.request_count),
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      totalTokens: toNumber(row.total_tokens, toNumber(row.input_tokens) + toNumber(row.output_tokens)),
      cacheTokens: toNumber(row.cache_tokens),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    channels: (byName.channels ?? []).map((row) => ({
      channelId: toNumber(row.channel_id),
      channelName: String(row.channel_name ?? ""),
      requestCount: toNumber(row.request_count),
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      totalTokens: toNumber(row.total_tokens, toNumber(row.input_tokens) + toNumber(row.output_tokens)),
      cacheTokens: toNumber(row.cache_tokens),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
  };
}

export async function getDashboardRollupTokenDetail(
  plan: DashboardRollupQueryPlan,
  token: { tokenId: number; tokenName: string },
  config: DashboardRollupConfig = getDashboardRollupConfig(),
): Promise<DashboardRollupTokenDetailResult> {
  try {
    const detail = await withTransactionImpl(
      (client) => executeDashboardRollupTokenDetail(client, plan, token),
      readTxOptions(config),
    );
    return { kind: "ready", detail };
  } catch (error) {
    logSafe("token-detail", error);
    return { kind: "error", safeMessage: SAFE_PACKET_ERROR };
  }
}
