import { query } from "@/lib/db";
import {
  assertLegacyDashboardFilters,
  buildDashboardQueryPlan,
  parseDashboardRouteFilters,
  peekDashboardPreset,
  type DashboardQueryPlan,
} from "@/lib/dashboard/dashboard-routing";
import { getDashboardRollupConfig } from "@/lib/dashboard/rollup-config";
import {
  getDashboardRollupModelOptions,
  getDashboardRollupReadiness,
} from "@/lib/dashboard/rollup-query";

export type FilterPreset = "today" | "24h" | "7d" | "30d" | "custom" | "all";
export type TrendGranularity = "hour" | "day";
export type SearchParamsInput = Record<string, string | string[] | undefined>;

export interface DashboardFilters {
  preset: FilterPreset;
  token: string;
  username: string;
  model: string;
  channelId: string;
  startInput: string;
  endInput: string;
  startTimestamp: number | null;
  endTimestamp: number | null;
  granularity: TrendGranularity;
  windowLabel: string;
}

export interface SummaryMetrics {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  avgOutputTokensPerSec: number | null;
  activeUserCount: number;
  activeChannelCount: number;
}

export interface TokenDetailModelRow {
  modelName: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  latestUsedAt: number;
}

export interface TokenDetailChannelRow {
  channelId: number;
  channelName: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  latestUsedAt: number;
}

export interface TokenDetailData {
  firstUsedAt: number;
  activeModelCount: number;
  activeChannelCount: number;
  models: TokenDetailModelRow[];
  channels: TokenDetailChannelRow[];
}

export interface TokenRankingRow {
  tokenId: number;
  tokenName: string;
  username: string;
  displayName: string;
  status: number;
  expiredTime: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  outputTokensPerSec: number | null;
  latestUsedAt: number;
  detail?: TokenDetailData;
}

export interface UserRankingRow {
  userId: number;
  username: string;
  displayName: string;
  status: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  outputTokensPerSec: number | null;
  latestUsedAt: number;
}

export interface ModelRankingRow {
  modelName: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  outputTokensPerSec: number | null;
  latestUsedAt: number;
}

export interface ChannelRankingRow {
  channelId: number;
  channelName: string;
  type: number;
  status: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  outputTokensPerSec: number | null;
  latestUsedAt: number;
}

export interface StabilitySummary {
  totalAttempts: number;
  successCount: number;
  errorCount: number;
  errorRate: number | null;
  avgFirstTokenLatency: number | null;
  avgTotalResponseTime: number | null;
}

export interface ModelStabilityRow {
  modelName: string;
  totalAttempts: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  avgFirstTokenLatency: number | null;
  avgTotalResponseTime: number | null;
  avgOutputTokensPerSec: number | null;
  latestUsedAt: number;
}

export interface ChannelStabilityRow {
  channelId: number;
  channelName: string;
  type: number;
  status: number;
  totalAttempts: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  avgFirstTokenLatency: number | null;
  avgTotalResponseTime: number | null;
  avgOutputTokensPerSec: number | null;
  latestUsedAt: number;
}

export interface TrendPoint {
  bucketTs: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface DashboardData {
  minTimestamp: number;
  maxTimestamp: number;
  generatedAt: number;
  filters: DashboardFilters;
  summary: SummaryMetrics;
  stabilitySummary: StabilitySummary;
  tokenRankings: TokenRankingRow[];
  userRankings: UserRankingRow[];
  modelRankings: ModelRankingRow[];
  channelRankings: ChannelRankingRow[];
  modelStability: ModelStabilityRow[];
  channelStability: ChannelStabilityRow[];
  trend: TrendPoint[];
  usernameOptions: FilterOption[];
  modelOptions: FilterOption[];
  channelOptions: FilterOption[];
}

interface TimeBoundsRow {
  min_ts: string | number | null;
  max_ts: string | number | null;
}

function toNumber(value: string | number | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function getNormalizedModelSql(expression: string) {
  return `COALESCE(NULLIF(BTRIM(regexp_replace(COALESCE(${expression}, ''), '\\s*\\([^)]*\\)$', '')), ''), 'Unknown')`;
}

function buildLogsWhere(filters: DashboardFilters, alias = "l") {
  const values: Array<string | number> = [];
  const clauses: string[] = [];
  const normalizedModelSql = getNormalizedModelSql(`${alias}.model_name`);

  if (filters.startTimestamp !== null) {
    values.push(filters.startTimestamp);
    clauses.push(`${alias}.created_at >= $${values.length}`);
  }

  if (filters.endTimestamp !== null) {
    values.push(filters.endTimestamp);
    clauses.push(`${alias}.created_at <= $${values.length}`);
  }

  if (filters.token) {
    values.push(`%${filters.token}%`);
    clauses.push(`${alias}.token_name ILIKE $${values.length}`);
  }

  if (filters.username) {
    values.push(filters.username);
    clauses.push(`${alias}.username = $${values.length}`);
  }

  if (filters.model) {
    values.push(filters.model);
    clauses.push(`${normalizedModelSql} = $${values.length}`);
  }

  if (filters.channelId) {
    values.push(filters.channelId);
    clauses.push(`${alias}.channel_id = $${values.length}`);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function getCacheTokensSql(alias = "l") {
  return `CASE
    WHEN ${alias}.other IS NOT NULL AND ${alias}.other LIKE '{%'
    THEN COALESCE((${alias}.other::jsonb->>'cache_tokens')::bigint, 0)
       + CASE
           WHEN COALESCE((${alias}.other::jsonb->>'cache_creation_tokens_5m')::bigint, 0) > 0
             OR COALESCE((${alias}.other::jsonb->>'cache_creation_tokens_1h')::bigint, 0) > 0
           THEN COALESCE((${alias}.other::jsonb->>'cache_creation_tokens_5m')::bigint, 0)
              + COALESCE((${alias}.other::jsonb->>'cache_creation_tokens_1h')::bigint, 0)
           ELSE COALESCE((${alias}.other::jsonb->>'cache_creation_tokens')::bigint, 0)
         END
    ELSE 0
  END`;
}

function getInputTokensSql(alias = "l") {
  const cache = getCacheTokensSql(alias);
  return `CASE
    WHEN ${alias}.other IS NOT NULL AND ${alias}.other LIKE '{%'
      AND (${alias}.other::jsonb->>'usage_semantic' = 'anthropic')
    THEN ${alias}.prompt_tokens + ${cache}
    ELSE ${alias}.prompt_tokens
  END`;
}

function getValidFirstTokenLatencySql(expression: string) {
  return `CASE
    WHEN COALESCE(${expression}, '') LIKE '{%'
      AND (${expression}::jsonb ->> 'frt') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      AND (${expression}::jsonb ->> 'frt')::numeric >= 0
    THEN (${expression}::jsonb ->> 'frt')::numeric
    ELSE NULL
  END`;
}

function getNullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getDefaultTokenDetail(): TokenDetailData {
  return {
    firstUsedAt: 0,
    activeModelCount: 0,
    activeChannelCount: 0,
    models: [],
    channels: [],
  };
}

function getTokenDetailKey(tokenId: number, tokenName: string) {
  return tokenId > 0 ? String(tokenId) : `0::${tokenName}`;
}

function buildTokenTargetsCte(
  rows: Array<{ tokenId: number; tokenName: string }>,
  baseValues: Array<string | number>,
) {
  const values = [...baseValues];
  const placeholders = rows.map((row) => {
    values.push(row.tokenId);
    const tokenIdIndex = values.length;
    values.push(row.tokenName);
    const tokenNameIndex = values.length;

    return `($${tokenIdIndex}::bigint, $${tokenNameIndex}::text)`;
  });

  return {
    values,
    cteSql: `target_tokens(token_id, token_name) AS (VALUES ${placeholders.join(", ")})`,
  };
}


export interface DashboardShellData {
  minTimestamp: number;
  maxTimestamp: number;
  generatedAt: number;
  filters: DashboardFilters;
  usernameOptions: FilterOption[];
  modelOptions: FilterOption[];
  channelOptions: FilterOption[];
}

function isDashboardFilters(input: SearchParamsInput | DashboardFilters): input is DashboardFilters {
  return typeof (input as DashboardFilters).preset === "string" && typeof (input as DashboardFilters).windowLabel === "string";
}

const LONG_RANGE_RAW_ERROR =
  "getDashboardData does not support long-range raw queries; use rollup packet routing";

async function fetchLogsTimeBounds(): Promise<{ minTimestamp: number; maxTimestamp: number }> {
  const timeBoundsResult = await query<TimeBoundsRow>(
    "SELECT MIN(created_at) AS min_ts, MAX(created_at) AS max_ts FROM logs",
  );
  const timeBounds = timeBoundsResult.rows[0];
  const minTimestamp = toNumber(timeBounds?.min_ts);
  const maxTimestamp = toNumber(timeBounds?.max_ts);

  if (!maxTimestamp) {
    throw new Error("No log data available in the database.");
  }

  return { minTimestamp, maxTimestamp };
}

/**
 * Classify the dashboard request before any long-range raw logs aggregate.
 * 30d/all never issue MIN/MAX(logs.created_at). Custom uses typed bounds only.
 */
export async function resolveDashboardQueryPlan(
  searchParams: SearchParamsInput = {},
): Promise<DashboardQueryPlan> {
  const preset = peekDashboardPreset(searchParams);

  if (preset === "30d" || preset === "all") {
    const filters = parseDashboardRouteFilters(searchParams);
    const config = getDashboardRollupConfig();
    const readiness = await getDashboardRollupReadiness(config);
    return buildDashboardQueryPlan(filters, readiness, config.readsEnabled);
  }

  if (preset === "custom") {
    const filters = parseDashboardRouteFilters(searchParams);
    const config = getDashboardRollupConfig();
    // Classification for custom does not need readiness/DB; unsupported path never scans logs.
    const readiness = {
      kind: "disabled" as const,
      processedRows: 0,
      safeMessage: "",
    };
    return buildDashboardQueryPlan(filters, readiness, config.readsEnabled);
  }

  // today / 24h / 7d — retain current MIN/MAX source-bound semantics
  const bounds = await fetchLogsTimeBounds();
  const filters = parseDashboardRouteFilters(searchParams, bounds);
  return buildDashboardQueryPlan(
    filters,
    { kind: "disabled", processedRows: 0, safeMessage: "" },
    false,
  );
}

async function getDashboardQueryContext(input: SearchParamsInput | DashboardFilters = {}) {
  let minTimestamp = 0;
  let maxTimestamp = 0;
  let filters: DashboardFilters;

  if (isDashboardFilters(input)) {
    assertLegacyDashboardFilters(input);
    filters = input;
  } else {
    const plan = await resolveDashboardQueryPlan(input);
    if (plan.kind !== "legacy") {
      throw new Error(LONG_RANGE_RAW_ERROR);
    }
    filters = plan.filters;
    if (filters.preset === "today" || filters.preset === "24h" || filters.preset === "7d") {
      const bounds = await fetchLogsTimeBounds();
      minTimestamp = bounds.minTimestamp;
      maxTimestamp = bounds.maxTimestamp;
    }
  }

  const { whereSql, values } = buildLogsWhere(filters);

  return {
    minTimestamp,
    maxTimestamp,
    filters,
    whereSql,
    values,
    normalizedModelSql: getNormalizedModelSql("l.model_name"),
    validFirstTokenLatencySql: getValidFirstTokenLatencySql("l.other"),
    cacheTokensSql: getCacheTokensSql("l"),
  };
}

async function loadUserAndChannelOptions(): Promise<{
  usernameOptions: FilterOption[];
  channelOptions: FilterOption[];
}> {
  const [usernameOptionResult, channelOptionResult] = await Promise.all([
    query<{ username: string }>(
      `
        SELECT username
        FROM users
        WHERE username <> ''
        ORDER BY username ASC
      `,
    ),
    query<{ id: string | number; label: string }>(
      `
        SELECT
          id,
          COALESCE(NULLIF(name, ''), CONCAT('渠道 ', id::text)) AS label
        FROM channels
        ORDER BY label ASC
      `,
    ),
  ]);

  return {
    usernameOptions: usernameOptionResult.rows.map((row) => ({
      value: String(row.username ?? ""),
      label: String(row.username ?? ""),
    })),
    channelOptions: channelOptionResult.rows.map((row) => ({
      value: String(row.id),
      label: row.label,
    })),
  };
}

async function loadRawModelOptions(): Promise<FilterOption[]> {
  const normalizedModelSql = getNormalizedModelSql("l.model_name");
  const modelOptionResult = await query<{ model_name: string }>(
    `
      SELECT DISTINCT normalized_model AS model_name
      FROM (
        SELECT ${normalizedModelSql} AS normalized_model
        FROM logs l
        WHERE l.model_name <> ''
      ) models
      WHERE normalized_model <> 'Unknown'
      ORDER BY model_name ASC
    `,
  );
  return modelOptionResult.rows.map((row) => ({
    value: String(row.model_name ?? ""),
    label: String(row.model_name ?? ""),
  }));
}

export async function getDashboardShellData(
  searchParams: SearchParamsInput = {},
  resolvedPlan?: DashboardQueryPlan,
): Promise<DashboardShellData> {
  const plan = resolvedPlan ?? (await resolveDashboardQueryPlan(searchParams));
  const { usernameOptions, channelOptions } = await loadUserAndChannelOptions();

  if (plan.kind === "rollup") {
    const modelOptions = await getDashboardRollupModelOptions(plan.version);
    return {
      minTimestamp: plan.startTimestamp ?? 0,
      maxTimestamp: plan.endTimestamp ?? 0,
      generatedAt: Date.now(),
      filters: plan.filters,
      usernameOptions,
      modelOptions,
      channelOptions,
    };
  }

  if (plan.kind === "unavailable") {
    return {
      minTimestamp: 0,
      maxTimestamp: 0,
      generatedAt: Date.now(),
      filters: plan.filters,
      usernameOptions,
      modelOptions: [],
      channelOptions,
    };
  }

  // legacy short path — retain raw model options
  let minTimestamp = 0;
  let maxTimestamp = 0;
  if (plan.filters.preset === "today" || plan.filters.preset === "24h" || plan.filters.preset === "7d") {
    const bounds = await fetchLogsTimeBounds();
    minTimestamp = bounds.minTimestamp;
    maxTimestamp = bounds.maxTimestamp;
  }

  const modelOptions = await loadRawModelOptions();

  return {
    minTimestamp,
    maxTimestamp,
    generatedAt: Date.now(),
    filters: plan.filters,
    usernameOptions,
    modelOptions,
    channelOptions,
  };
}

export async function getDashboardSummaryData(searchParams: SearchParamsInput | DashboardFilters = {}) {
  const { whereSql, values, validFirstTokenLatencySql, cacheTokensSql } = await getDashboardQueryContext(searchParams);
  const [summaryResult, stabilitySummaryResult] = await Promise.all([
    query<{
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
      active_user_count: string | number;
      active_channel_count: string | number;
      avg_output_tokens_per_sec: string | number | null;
    }>(
      `
        SELECT
          COUNT(*) AS request_count,
          COALESCE(SUM(${getInputTokensSql("l")}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("l")} + l.completion_tokens), 0) AS total_tokens,
          COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens,
          COUNT(DISTINCT l.user_id) AS active_user_count,
          COUNT(DISTINCT l.channel_id) AS active_channel_count,
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec
        FROM logs l
        ${whereSql}
      `,
      values,
    ),
    query<{
      total_attempts: string | number;
      success_count: string | number;
      error_count: string | number;
      error_rate: string | number | null;
      avg_first_token_latency: string | number | null;
      avg_total_response_time: string | number | null;
    }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE l.type IN (2, 5)) AS total_attempts,
          COUNT(*) FILTER (WHERE l.type = 2) AS success_count,
          COUNT(*) FILTER (WHERE l.type = 5) AS error_count,
          COUNT(*) FILTER (WHERE l.type = 5)::double precision / NULLIF(COUNT(*) FILTER (WHERE l.type IN (2, 5)), 0) AS error_rate,
          AVG(${validFirstTokenLatencySql}) FILTER (WHERE l.type = 2) AS avg_first_token_latency,
          AVG(NULLIF(l.use_time, 0)) FILTER (WHERE l.type = 2) AS avg_total_response_time
        FROM logs l
        ${whereSql}
      `,
      values,
    ),
  ]);

  const summaryRow = summaryResult.rows[0];
  const stabilitySummaryRow = stabilitySummaryResult.rows[0];
  return {
    summary: {
      requestCount: toNumber(summaryRow?.request_count),
      inputTokens: toNumber(summaryRow?.input_tokens),
      outputTokens: toNumber(summaryRow?.output_tokens),
      totalTokens: toNumber(summaryRow?.total_tokens),
      cacheTokens: toNumber(summaryRow?.cache_tokens),
      avgOutputTokensPerSec: getNullableNumber(summaryRow?.avg_output_tokens_per_sec),
      activeUserCount: toNumber(summaryRow?.active_user_count),
      activeChannelCount: toNumber(summaryRow?.active_channel_count),
    } satisfies SummaryMetrics,
    stabilitySummary: {
      totalAttempts: toNumber(stabilitySummaryRow?.total_attempts),
      successCount: toNumber(stabilitySummaryRow?.success_count),
      errorCount: toNumber(stabilitySummaryRow?.error_count),
      errorRate: getNullableNumber(stabilitySummaryRow?.error_rate),
      avgFirstTokenLatency: getNullableNumber(stabilitySummaryRow?.avg_first_token_latency),
      avgTotalResponseTime: getNullableNumber(stabilitySummaryRow?.avg_total_response_time),
    } satisfies StabilitySummary,
  };
}

export async function getDashboardRankingData(searchParams: SearchParamsInput | DashboardFilters = {}) {
  const { whereSql, values, normalizedModelSql, cacheTokensSql } = await getDashboardQueryContext(searchParams);
  const [tokenResult, userResult, modelResult, channelResult] = await Promise.all([
    query<Record<string, string | number | null>>(`
      WITH filtered_logs AS (
        SELECT l.token_id, l.token_name, l.user_id, l.username, l.prompt_tokens, l.completion_tokens, l.other, l.created_at, ${cacheTokensSql} AS cache_tokens
        FROM logs l
        ${whereSql}
      ), aggregated AS (
        SELECT COALESCE(token_id, 0) AS token_id, COALESCE(NULLIF(token_name, ''), 'Unknown') AS log_token_name, MAX(user_id) AS user_id, MAX(NULLIF(username, '')) AS log_username,
          COUNT(*) AS request_count, COALESCE(SUM(${getInputTokensSql("filtered_logs")}), 0) AS input_tokens, COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("filtered_logs")} + completion_tokens), 0) AS total_tokens, COALESCE(SUM(cache_tokens), 0) AS cache_tokens, MAX(created_at) AS latest_used_at
        FROM filtered_logs GROUP BY COALESCE(token_id, 0), COALESCE(NULLIF(token_name, ''), 'Unknown')
      )
      SELECT aggregated.token_id, COALESCE(NULLIF(tokens.name, ''), aggregated.log_token_name) AS token_name, COALESCE(users.username, aggregated.log_username, 'Unknown') AS username,
        COALESCE(users.display_name, '') AS display_name, COALESCE(tokens.status, -1) AS status, COALESCE(tokens.expired_time, -1) AS expired_time,
        aggregated.request_count, aggregated.input_tokens, aggregated.output_tokens, aggregated.total_tokens, aggregated.cache_tokens, aggregated.latest_used_at
      FROM aggregated
      LEFT JOIN tokens ON tokens.id = aggregated.token_id
      LEFT JOIN users ON users.id = COALESCE(tokens.user_id, aggregated.user_id)
      ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC
      LIMIT 20
    `, values),
    query<Record<string, string | number | null>>(`
      WITH filtered_logs AS (
        SELECT l.user_id, l.username, l.prompt_tokens, l.completion_tokens, l.other, l.created_at, ${cacheTokensSql} AS cache_tokens FROM logs l ${whereSql}
      ), aggregated AS (
        SELECT COALESCE(user_id, 0) AS user_id, COALESCE(NULLIF(username, ''), 'Unknown') AS log_username, COUNT(*) AS request_count,
          COALESCE(SUM(${getInputTokensSql("filtered_logs")}), 0) AS input_tokens, COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("filtered_logs")} + completion_tokens), 0) AS total_tokens, COALESCE(SUM(cache_tokens), 0) AS cache_tokens, MAX(created_at) AS latest_used_at
        FROM filtered_logs GROUP BY COALESCE(user_id, 0), COALESCE(NULLIF(username, ''), 'Unknown')
      )
      SELECT aggregated.user_id, COALESCE(users.username, aggregated.log_username, 'Unknown') AS username, COALESCE(users.display_name, '') AS display_name,
        COALESCE(users.status, -1) AS status, aggregated.request_count, aggregated.input_tokens, aggregated.output_tokens, aggregated.total_tokens, aggregated.cache_tokens, aggregated.latest_used_at
      FROM aggregated LEFT JOIN users ON users.id = aggregated.user_id
      ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC LIMIT 12
    `, values),
    query<Record<string, string | number | null>>(`
      SELECT ${normalizedModelSql} AS model_name, COUNT(*) AS request_count, COALESCE(SUM(${getInputTokensSql("l")}), 0) AS input_tokens,
        COALESCE(SUM(l.completion_tokens), 0) AS output_tokens, COALESCE(SUM(${getInputTokensSql("l")} + l.completion_tokens), 0) AS total_tokens,
        COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens, AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS output_tokens_per_sec,
        MAX(l.created_at) AS latest_used_at
      FROM logs l ${whereSql} GROUP BY 1 ORDER BY total_tokens DESC, request_count DESC LIMIT 12
    `, values),
    query<Record<string, string | number | null>>(`
      WITH filtered_logs AS (
        SELECT l.channel_id, l.channel_name, l.prompt_tokens, l.completion_tokens, l.type, l.use_time, l.other, l.created_at, ${cacheTokensSql} AS cache_tokens FROM logs l ${whereSql}
      ), aggregated AS (
        SELECT COALESCE(channel_id, 0) AS channel_id, MAX(NULLIF(channel_name, '')) AS log_channel_name, COUNT(*) AS request_count,
          COALESCE(SUM(${getInputTokensSql("filtered_logs")}), 0) AS input_tokens, COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("filtered_logs")} + completion_tokens), 0) AS total_tokens, COALESCE(SUM(cache_tokens), 0) AS cache_tokens,
          AVG(CASE WHEN type = 2 AND use_time > 0 AND completion_tokens > 0 THEN completion_tokens::numeric / NULLIF(use_time, 0) END) AS output_tokens_per_sec, MAX(created_at) AS latest_used_at
        FROM filtered_logs GROUP BY COALESCE(channel_id, 0)
      )
      SELECT aggregated.channel_id, COALESCE(NULLIF(channels.name, ''), aggregated.log_channel_name, CONCAT('渠道 ', aggregated.channel_id::text)) AS channel_name,
        COALESCE(channels.type, -1) AS type, COALESCE(channels.status, -1) AS status, aggregated.request_count, aggregated.input_tokens, aggregated.output_tokens,
        aggregated.total_tokens, aggregated.cache_tokens, aggregated.output_tokens_per_sec, aggregated.latest_used_at
      FROM aggregated LEFT JOIN channels ON channels.id = aggregated.channel_id
      ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC LIMIT 12
    `, values),
  ]);

  return {
    tokenRankings: tokenResult.rows.map((row) => ({
      tokenId: toNumber(row.token_id), tokenName: String(row.token_name ?? ""), username: String(row.username ?? ""), displayName: String(row.display_name ?? ""), status: toNumber(row.status, -1), expiredTime: toNumber(row.expired_time, -1),
      requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens), outputTokensPerSec: null, latestUsedAt: toNumber(row.latest_used_at),
    })) as TokenRankingRow[],
    userRankings: userResult.rows.map((row) => ({ userId: toNumber(row.user_id), username: String(row.username ?? ""), displayName: String(row.display_name ?? ""), status: toNumber(row.status, -1), requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens), outputTokensPerSec: null, latestUsedAt: toNumber(row.latest_used_at) })) as UserRankingRow[],
    modelRankings: modelResult.rows.map((row) => ({ modelName: String(row.model_name ?? ""), requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens), outputTokensPerSec: getNullableNumber(row.output_tokens_per_sec), latestUsedAt: toNumber(row.latest_used_at) })) as ModelRankingRow[],
    channelRankings: channelResult.rows.map((row) => ({ channelId: toNumber(row.channel_id), channelName: String(row.channel_name ?? ""), type: toNumber(row.type, -1), status: toNumber(row.status, -1), requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens), outputTokensPerSec: getNullableNumber(row.output_tokens_per_sec), latestUsedAt: toNumber(row.latest_used_at) })) as ChannelRankingRow[],
  };
}

export async function getDashboardStabilityData(searchParams: SearchParamsInput | DashboardFilters = {}) {
  const { whereSql, values, normalizedModelSql, validFirstTokenLatencySql } = await getDashboardQueryContext(searchParams);
  const [modelStabilityResult, channelStabilityResult] = await Promise.all([
    query<Record<string, string | number | null>>(`
      SELECT ${normalizedModelSql} AS model_name, COUNT(*) FILTER (WHERE l.type IN (2, 5)) AS total_attempts, COUNT(*) FILTER (WHERE l.type = 2) AS success_count,
        COUNT(*) FILTER (WHERE l.type = 5) AS error_count, COUNT(*) FILTER (WHERE l.type = 5)::double precision / NULLIF(COUNT(*) FILTER (WHERE l.type IN (2, 5)), 0) AS error_rate,
        AVG(${validFirstTokenLatencySql}) FILTER (WHERE l.type = 2) AS avg_first_token_latency, AVG(NULLIF(l.use_time, 0)) FILTER (WHERE l.type = 2) AS avg_total_response_time,
        AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec, MAX(l.created_at) AS latest_used_at
      FROM logs l ${whereSql} GROUP BY 1 HAVING COUNT(*) FILTER (WHERE l.type IN (2, 5)) > 0 ORDER BY error_rate DESC NULLS LAST, total_attempts DESC, latest_used_at DESC LIMIT 12
    `, values),
    query<Record<string, string | number | null>>(`
      WITH aggregated AS (
        SELECT COALESCE(l.channel_id, 0) AS channel_id, MAX(NULLIF(l.channel_name, '')) AS log_channel_name, COUNT(*) FILTER (WHERE l.type IN (2, 5)) AS total_attempts,
          COUNT(*) FILTER (WHERE l.type = 2) AS success_count, COUNT(*) FILTER (WHERE l.type = 5) AS error_count,
          COUNT(*) FILTER (WHERE l.type = 5)::double precision / NULLIF(COUNT(*) FILTER (WHERE l.type IN (2, 5)), 0) AS error_rate,
          AVG(${validFirstTokenLatencySql}) FILTER (WHERE l.type = 2) AS avg_first_token_latency, AVG(NULLIF(l.use_time, 0)) FILTER (WHERE l.type = 2) AS avg_total_response_time,
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec, MAX(l.created_at) AS latest_used_at
        FROM logs l ${whereSql} GROUP BY COALESCE(l.channel_id, 0)
      )
      SELECT aggregated.channel_id, COALESCE(NULLIF(channels.name, ''), aggregated.log_channel_name, CONCAT('渠道 ', aggregated.channel_id::text)) AS channel_name,
        COALESCE(channels.type, -1) AS type, COALESCE(channels.status, -1) AS status, aggregated.total_attempts, aggregated.success_count, aggregated.error_count,
        aggregated.error_rate, aggregated.avg_first_token_latency, aggregated.avg_total_response_time, aggregated.avg_output_tokens_per_sec, aggregated.latest_used_at
      FROM aggregated LEFT JOIN channels ON channels.id = aggregated.channel_id WHERE aggregated.total_attempts > 0
      ORDER BY aggregated.error_rate DESC NULLS LAST, aggregated.total_attempts DESC, aggregated.latest_used_at DESC LIMIT 12
    `, values),
  ]);

  return {
    modelStability: modelStabilityResult.rows.map((row) => ({ modelName: String(row.model_name ?? ""), totalAttempts: toNumber(row.total_attempts), successCount: toNumber(row.success_count), errorCount: toNumber(row.error_count), errorRate: toNumber(row.error_rate), avgFirstTokenLatency: getNullableNumber(row.avg_first_token_latency), avgTotalResponseTime: getNullableNumber(row.avg_total_response_time), avgOutputTokensPerSec: getNullableNumber(row.avg_output_tokens_per_sec), latestUsedAt: toNumber(row.latest_used_at) })) as ModelStabilityRow[],
    channelStability: channelStabilityResult.rows.map((row) => ({ channelId: toNumber(row.channel_id), channelName: String(row.channel_name ?? ""), type: toNumber(row.type, -1), status: toNumber(row.status, -1), totalAttempts: toNumber(row.total_attempts), successCount: toNumber(row.success_count), errorCount: toNumber(row.error_count), errorRate: toNumber(row.error_rate), avgFirstTokenLatency: getNullableNumber(row.avg_first_token_latency), avgTotalResponseTime: getNullableNumber(row.avg_total_response_time), avgOutputTokensPerSec: getNullableNumber(row.avg_output_tokens_per_sec), latestUsedAt: toNumber(row.latest_used_at) })) as ChannelStabilityRow[],
  };
}

export async function getDashboardTrendData(searchParams: SearchParamsInput | DashboardFilters = {}) {
  const { filters, whereSql, values, cacheTokensSql } = await getDashboardQueryContext(searchParams);
  const trendResult = await query<Record<string, string | number | null>>(`
    SELECT EXTRACT(EPOCH FROM date_trunc('${filters.granularity}', to_timestamp(l.created_at))) AS bucket_ts, COUNT(*) AS request_count,
      COALESCE(SUM(${getInputTokensSql("l")}), 0) AS input_tokens, COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
      COALESCE(SUM(${getInputTokensSql("l")} + l.completion_tokens), 0) AS total_tokens, COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens
    FROM logs l ${whereSql} GROUP BY 1 ORDER BY 1 ASC
  `, values);

  return {
    granularity: filters.granularity,
    trend: trendResult.rows.map((row) => ({ bucketTs: toNumber(row.bucket_ts), requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens) })) as TrendPoint[],
  };
}

export async function getTokenDetailData(searchParams: SearchParamsInput | DashboardFilters = {}, tokenId: number, tokenName: string): Promise<TokenDetailData> {
  const { whereSql, values, normalizedModelSql, cacheTokensSql } = await getDashboardQueryContext(searchParams);
  const { values: detailValues, cteSql } = buildTokenTargetsCte([{ tokenId, tokenName }], values);
  const detailBaseSql = `
    WITH ${cteSql}, filtered_logs AS (
      SELECT COALESCE(l.token_id, 0) AS token_id, COALESCE(NULLIF(l.token_name, ''), 'Unknown') AS token_name, ${normalizedModelSql} AS normalized_model,
        COALESCE(l.channel_id, 0) AS channel_id, l.channel_name, l.prompt_tokens, l.completion_tokens, l.other, l.created_at, ${cacheTokensSql} AS cache_tokens
      FROM logs l ${whereSql}
    ), matched_logs AS (
      SELECT filtered_logs.* FROM filtered_logs INNER JOIN target_tokens ON target_tokens.token_id = filtered_logs.token_id AND (target_tokens.token_id <> 0 OR target_tokens.token_name = filtered_logs.token_name)
    )`;
  const [summaryResult, modelResult, channelResult] = await Promise.all([
    query<Record<string, string | number | null>>(`${detailBaseSql} SELECT token_id, token_name, MIN(created_at) AS first_used_at, COUNT(DISTINCT normalized_model) FILTER (WHERE normalized_model <> 'Unknown') AS active_model_count, COUNT(DISTINCT channel_id) FILTER (WHERE channel_id <> 0) AS active_channel_count FROM matched_logs GROUP BY token_id, token_name`, detailValues),
    query<Record<string, string | number | null>>(`${detailBaseSql}, aggregated AS (SELECT token_id, token_name, normalized_model AS model_name, COUNT(*) AS request_count, COALESCE(SUM(${getInputTokensSql("matched_logs")}), 0) AS input_tokens, COALESCE(SUM(completion_tokens), 0) AS output_tokens, COALESCE(SUM(${getInputTokensSql("matched_logs")} + completion_tokens), 0) AS total_tokens, COALESCE(SUM(cache_tokens), 0) AS cache_tokens, MAX(created_at) AS latest_used_at FROM matched_logs WHERE normalized_model <> 'Unknown' GROUP BY token_id, token_name, normalized_model), ranked AS (SELECT aggregated.*, ROW_NUMBER() OVER (PARTITION BY token_id, token_name ORDER BY total_tokens DESC, request_count DESC) AS row_number FROM aggregated) SELECT model_name, request_count, input_tokens, output_tokens, total_tokens, cache_tokens, latest_used_at FROM ranked WHERE row_number <= 6 ORDER BY row_number ASC`, detailValues),
    query<Record<string, string | number | null>>(`${detailBaseSql}, aggregated AS (SELECT matched_logs.token_id, matched_logs.token_name, matched_logs.channel_id, COALESCE(NULLIF(channels.name, ''), MAX(NULLIF(matched_logs.channel_name, '')), CONCAT('渠道 ', matched_logs.channel_id::text)) AS channel_name, COUNT(*) AS request_count, COALESCE(SUM(${getInputTokensSql("matched_logs")}), 0) AS input_tokens, COALESCE(SUM(matched_logs.completion_tokens), 0) AS output_tokens, COALESCE(SUM(${getInputTokensSql("matched_logs")} + matched_logs.completion_tokens), 0) AS total_tokens, COALESCE(SUM(matched_logs.cache_tokens), 0) AS cache_tokens, MAX(matched_logs.created_at) AS latest_used_at FROM matched_logs LEFT JOIN channels ON channels.id = matched_logs.channel_id GROUP BY matched_logs.token_id, matched_logs.token_name, matched_logs.channel_id, channels.name), ranked AS (SELECT aggregated.*, ROW_NUMBER() OVER (PARTITION BY token_id, token_name ORDER BY total_tokens DESC, request_count DESC) AS row_number FROM aggregated WHERE channel_id <> 0) SELECT channel_id, channel_name, request_count, input_tokens, output_tokens, total_tokens, cache_tokens, latest_used_at FROM ranked WHERE row_number <= 6 ORDER BY row_number ASC`, detailValues),
  ]);
  const summary = summaryResult.rows[0];
  return {
    firstUsedAt: toNumber(summary?.first_used_at),
    activeModelCount: toNumber(summary?.active_model_count),
    activeChannelCount: toNumber(summary?.active_channel_count),
    models: modelResult.rows.map((row) => ({ modelName: String(row.model_name ?? ""), requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens), latestUsedAt: toNumber(row.latest_used_at) })),
    channels: channelResult.rows.map((row) => ({ channelId: toNumber(row.channel_id), channelName: String(row.channel_name ?? ""), requestCount: toNumber(row.request_count), inputTokens: toNumber(row.input_tokens), outputTokens: toNumber(row.output_tokens), totalTokens: toNumber(row.total_tokens), cacheTokens: toNumber(row.cache_tokens), latestUsedAt: toNumber(row.latest_used_at) })),
  };
}

export async function getDashboardData(searchParams: SearchParamsInput = {}): Promise<DashboardData> {
  const plan = await resolveDashboardQueryPlan(searchParams);
  if (plan.kind !== "legacy") {
    throw new Error(LONG_RANGE_RAW_ERROR);
  }

  const timeBoundsResult = await query<TimeBoundsRow>(
    "SELECT MIN(created_at) AS min_ts, MAX(created_at) AS max_ts FROM logs",
  );

  const timeBounds = timeBoundsResult.rows[0];
  const minTimestamp = toNumber(timeBounds?.min_ts);
  const maxTimestamp = toNumber(timeBounds?.max_ts);

  if (!maxTimestamp) {
    throw new Error("No log data available in the database.");
  }

  const filters = plan.filters;
  const { whereSql, values } = buildLogsWhere(filters);
  const trendBucket = filters.granularity;
  const normalizedModelSql = getNormalizedModelSql("l.model_name");
  const validFirstTokenLatencySql = getValidFirstTokenLatencySql("l.other");
  const cacheTokensSql = getCacheTokensSql("l");

  const [
    summaryResult,
    stabilitySummaryResult,
    tokenResult,
    userResult,
    modelResult,
    channelResult,
    modelStabilityResult,
    channelStabilityResult,
    trendResult,
    usernameOptionResult,
    modelOptionResult,
    channelOptionResult,
  ] = await Promise.all([
    query<{
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
      active_user_count: string | number;
      active_channel_count: string | number;
      avg_output_tokens_per_sec: string | number | null;
    }>(
      `
        SELECT
          COUNT(*) AS request_count,
          COALESCE(SUM(${getInputTokensSql("l")}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("l")} + l.completion_tokens), 0) AS total_tokens,
          COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens,
          COUNT(DISTINCT l.user_id) AS active_user_count,
          COUNT(DISTINCT l.channel_id) AS active_channel_count,
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec
        FROM logs l
        ${whereSql}
      `,
      values,
    ),
    query<{
      total_attempts: string | number;
      success_count: string | number;
      error_count: string | number;
      error_rate: string | number | null;
      avg_first_token_latency: string | number | null;
      avg_total_response_time: string | number | null;
    }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE l.type IN (2, 5)) AS total_attempts,
          COUNT(*) FILTER (WHERE l.type = 2) AS success_count,
          COUNT(*) FILTER (WHERE l.type = 5) AS error_count,
          COUNT(*) FILTER (WHERE l.type = 5)::double precision / NULLIF(COUNT(*) FILTER (WHERE l.type IN (2, 5)), 0) AS error_rate,
          AVG(${validFirstTokenLatencySql}) FILTER (WHERE l.type = 2) AS avg_first_token_latency,
          AVG(NULLIF(l.use_time, 0)) FILTER (WHERE l.type = 2) AS avg_total_response_time
        FROM logs l
        ${whereSql}
      `,
      values,
    ),
    query<{
      token_id: string | number;
      token_name: string;
      username: string;
      display_name: string;
      status: string | number;
      expired_time: string | number;
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
      latest_used_at: string | number;
    }>(
      `
        WITH filtered_logs AS (
          SELECT
            l.token_id,
            l.token_name,
            l.user_id,
            l.username,
            l.prompt_tokens,
            l.completion_tokens,
            l.other,
            l.created_at,
            ${cacheTokensSql} AS cache_tokens
          FROM logs l
          ${whereSql}
        ),
        aggregated AS (
          SELECT
            COALESCE(token_id, 0) AS token_id,
            COALESCE(NULLIF(token_name, ''), 'Unknown') AS log_token_name,
            MAX(user_id) AS user_id,
            MAX(NULLIF(username, '')) AS log_username,
            COUNT(*) AS request_count,
            COALESCE(SUM(${getInputTokensSql("filtered_logs")}), 0) AS input_tokens,
            COALESCE(SUM(completion_tokens), 0) AS output_tokens,
            COALESCE(SUM(${getInputTokensSql("filtered_logs")} + completion_tokens), 0) AS total_tokens,
            COALESCE(SUM(cache_tokens), 0) AS cache_tokens,
            MAX(created_at) AS latest_used_at
          FROM filtered_logs
          GROUP BY COALESCE(token_id, 0), COALESCE(NULLIF(token_name, ''), 'Unknown')
        )
        SELECT
          aggregated.token_id,
          COALESCE(NULLIF(tokens.name, ''), aggregated.log_token_name) AS token_name,
          COALESCE(users.username, aggregated.log_username, 'Unknown') AS username,
          COALESCE(users.display_name, '') AS display_name,
          COALESCE(tokens.status, -1) AS status,
          COALESCE(tokens.expired_time, -1) AS expired_time,
          aggregated.request_count,
          aggregated.input_tokens,
          aggregated.output_tokens,
          aggregated.total_tokens,
          aggregated.cache_tokens,
          aggregated.latest_used_at
        FROM aggregated
        LEFT JOIN tokens ON tokens.id = aggregated.token_id
        LEFT JOIN users ON users.id = COALESCE(tokens.user_id, aggregated.user_id)
        ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC
        LIMIT 20
      `,
      values,
    ),
    query<{
      user_id: string | number;
      username: string;
      display_name: string;
      status: string | number;
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
      latest_used_at: string | number;
    }>(
      `
        WITH filtered_logs AS (
          SELECT l.user_id, l.username, l.prompt_tokens, l.completion_tokens, l.other, l.created_at, ${cacheTokensSql} AS cache_tokens
          FROM logs l
          ${whereSql}
        ),
        aggregated AS (
          SELECT
            COALESCE(user_id, 0) AS user_id,
            COALESCE(NULLIF(username, ''), 'Unknown') AS log_username,
            COUNT(*) AS request_count,
            COALESCE(SUM(${getInputTokensSql("filtered_logs")}), 0) AS input_tokens,
            COALESCE(SUM(completion_tokens), 0) AS output_tokens,
            COALESCE(SUM(${getInputTokensSql("filtered_logs")} + completion_tokens), 0) AS total_tokens,
            COALESCE(SUM(cache_tokens), 0) AS cache_tokens,
            MAX(created_at) AS latest_used_at
          FROM filtered_logs
          GROUP BY COALESCE(user_id, 0), COALESCE(NULLIF(username, ''), 'Unknown')
        )
        SELECT
          aggregated.user_id,
          COALESCE(users.username, aggregated.log_username, 'Unknown') AS username,
          COALESCE(users.display_name, '') AS display_name,
          COALESCE(users.status, -1) AS status,
          aggregated.request_count,
          aggregated.input_tokens,
          aggregated.output_tokens,
          aggregated.total_tokens,
          aggregated.cache_tokens,
          aggregated.latest_used_at
        FROM aggregated
        LEFT JOIN users ON users.id = aggregated.user_id
        ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC
        LIMIT 12
      `,
      values,
    ),
    query<{
      model_name: string;
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
      output_tokens_per_sec: string | number | null;
      latest_used_at: string | number;
    }>(
      `
        SELECT
          ${normalizedModelSql} AS model_name,
          COUNT(*) AS request_count,
          COALESCE(SUM(${getInputTokensSql("l")}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("l")} + l.completion_tokens), 0) AS total_tokens,
          COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens,
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS output_tokens_per_sec,
          MAX(l.created_at) AS latest_used_at
        FROM logs l
        ${whereSql}
        GROUP BY 1
        ORDER BY total_tokens DESC, request_count DESC
        LIMIT 12
      `,
      values,
    ),
    query<{
      channel_id: string | number;
      channel_name: string;
      type: string | number;
      status: string | number;
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
      output_tokens_per_sec: string | number | null;
      latest_used_at: string | number;
    }>(
      `
        WITH filtered_logs AS (
          SELECT
            l.channel_id,
            l.channel_name,
            l.prompt_tokens,
            l.completion_tokens,
            l.type,
            l.use_time,
            l.other,
            l.created_at,
            ${cacheTokensSql} AS cache_tokens
          FROM logs l
          ${whereSql}
        ),
        aggregated AS (
          SELECT
            COALESCE(channel_id, 0) AS channel_id,
            MAX(NULLIF(channel_name, '')) AS log_channel_name,
            COUNT(*) AS request_count,
            COALESCE(SUM(${getInputTokensSql("filtered_logs")}), 0) AS input_tokens,
            COALESCE(SUM(completion_tokens), 0) AS output_tokens,
            COALESCE(SUM(${getInputTokensSql("filtered_logs")} + completion_tokens), 0) AS total_tokens,
            COALESCE(SUM(cache_tokens), 0) AS cache_tokens,
            AVG(CASE WHEN type = 2 AND use_time > 0 AND completion_tokens > 0 THEN completion_tokens::numeric / NULLIF(use_time, 0) END) AS output_tokens_per_sec,
            MAX(created_at) AS latest_used_at
          FROM filtered_logs
          GROUP BY COALESCE(channel_id, 0)
        )
        SELECT
          aggregated.channel_id,
          COALESCE(NULLIF(channels.name, ''), aggregated.log_channel_name, CONCAT('渠道 ', aggregated.channel_id::text)) AS channel_name,
          COALESCE(channels.type, -1) AS type,
          COALESCE(channels.status, -1) AS status,
          aggregated.request_count,
          aggregated.input_tokens,
          aggregated.output_tokens,
          aggregated.total_tokens,
          aggregated.cache_tokens,
          aggregated.output_tokens_per_sec,
          aggregated.latest_used_at
        FROM aggregated
        LEFT JOIN channels ON channels.id = aggregated.channel_id
        ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC
        LIMIT 12
      `,
      values,
    ),
    query<{
      model_name: string;
      total_attempts: string | number;
      success_count: string | number;
      error_count: string | number;
      error_rate: string | number;
      avg_first_token_latency: string | number | null;
      avg_total_response_time: string | number | null;
      avg_output_tokens_per_sec: string | number | null;
      latest_used_at: string | number;
    }>(
      `
        SELECT
          ${normalizedModelSql} AS model_name,
          COUNT(*) FILTER (WHERE l.type IN (2, 5)) AS total_attempts,
          COUNT(*) FILTER (WHERE l.type = 2) AS success_count,
          COUNT(*) FILTER (WHERE l.type = 5) AS error_count,
          COUNT(*) FILTER (WHERE l.type = 5)::double precision / NULLIF(COUNT(*) FILTER (WHERE l.type IN (2, 5)), 0) AS error_rate,
          AVG(${validFirstTokenLatencySql}) FILTER (WHERE l.type = 2) AS avg_first_token_latency,
          AVG(NULLIF(l.use_time, 0)) FILTER (WHERE l.type = 2) AS avg_total_response_time,
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec,
          MAX(l.created_at) AS latest_used_at
        FROM logs l
        ${whereSql}
        GROUP BY 1
        HAVING COUNT(*) FILTER (WHERE l.type IN (2, 5)) > 0
        ORDER BY error_rate DESC NULLS LAST, total_attempts DESC, latest_used_at DESC
        LIMIT 12
      `,
      values,
    ),
    query<{
      channel_id: string | number;
      channel_name: string;
      type: string | number;
      status: string | number;
      total_attempts: string | number;
      success_count: string | number;
      error_count: string | number;
      error_rate: string | number;
      avg_first_token_latency: string | number | null;
      avg_total_response_time: string | number | null;
      avg_output_tokens_per_sec: string | number | null;
      latest_used_at: string | number;
    }>(
      `
        WITH aggregated AS (
          SELECT
            COALESCE(l.channel_id, 0) AS channel_id,
            MAX(NULLIF(l.channel_name, '')) AS log_channel_name,
            COUNT(*) FILTER (WHERE l.type IN (2, 5)) AS total_attempts,
            COUNT(*) FILTER (WHERE l.type = 2) AS success_count,
            COUNT(*) FILTER (WHERE l.type = 5) AS error_count,
            COUNT(*) FILTER (WHERE l.type = 5)::double precision / NULLIF(COUNT(*) FILTER (WHERE l.type IN (2, 5)), 0) AS error_rate,
            AVG(${validFirstTokenLatencySql}) FILTER (WHERE l.type = 2) AS avg_first_token_latency,
            AVG(NULLIF(l.use_time, 0)) FILTER (WHERE l.type = 2) AS avg_total_response_time,
            AVG(CASE WHEN l.type = 2 AND l.use_time > 0 AND l.completion_tokens > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec,
            MAX(l.created_at) AS latest_used_at
          FROM logs l
          ${whereSql}
          GROUP BY COALESCE(l.channel_id, 0)
        )
        SELECT
          aggregated.channel_id,
          COALESCE(NULLIF(channels.name, ''), aggregated.log_channel_name, CONCAT('渠道 ', aggregated.channel_id::text)) AS channel_name,
          COALESCE(channels.type, -1) AS type,
          COALESCE(channels.status, -1) AS status,
          aggregated.total_attempts,
          aggregated.success_count,
          aggregated.error_count,
          aggregated.error_rate,
          aggregated.avg_first_token_latency,
          aggregated.avg_total_response_time,
          aggregated.avg_output_tokens_per_sec,
          aggregated.latest_used_at
        FROM aggregated
        LEFT JOIN channels ON channels.id = aggregated.channel_id
        WHERE aggregated.total_attempts > 0
        ORDER BY aggregated.error_rate DESC NULLS LAST, aggregated.total_attempts DESC, aggregated.latest_used_at DESC
        LIMIT 12
      `,
      values,
    ),
    query<{
      bucket_ts: string | number;
      request_count: string | number;
      input_tokens: string | number;
      output_tokens: string | number;
      total_tokens: string | number;
      cache_tokens: string | number;
    }>(
      `
        SELECT
          EXTRACT(EPOCH FROM date_trunc('${trendBucket}', to_timestamp(l.created_at))) AS bucket_ts,
          COUNT(*) AS request_count,
          COALESCE(SUM(${getInputTokensSql("l")}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(${getInputTokensSql("l")} + l.completion_tokens), 0) AS total_tokens,
          COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens
        FROM logs l
        ${whereSql}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      values,
    ),
    query<{ username: string }>(
      `
        SELECT username
        FROM users
        WHERE username <> ''
        ORDER BY username ASC
      `,
    ),
    query<{ model_name: string }>(
      `
        SELECT DISTINCT normalized_model AS model_name
        FROM (
          SELECT ${normalizedModelSql} AS normalized_model
          FROM logs l
          WHERE l.model_name <> ''
        ) models
        WHERE normalized_model <> 'Unknown'
        ORDER BY model_name ASC
      `,
    ),
    query<{ id: string | number; label: string }>(
      `
        SELECT
          id,
          COALESCE(NULLIF(name, ''), CONCAT('渠道 ', id::text)) AS label
        FROM channels
        ORDER BY label ASC
      `,
    ),
  ]);

  const summaryRow = summaryResult.rows[0];
  const stabilitySummaryRow = stabilitySummaryResult.rows[0];
  const baseTokenRankings = tokenResult.rows.map((row) => ({
    tokenId: toNumber(row.token_id),
    tokenName: String(row.token_name ?? ""),
    username: String(row.username ?? ""),
    displayName: String(row.display_name ?? ""),
    status: toNumber(row.status, -1),
    expiredTime: toNumber(row.expired_time, -1),
    requestCount: toNumber(row.request_count),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    totalTokens: toNumber(row.total_tokens),
    cacheTokens: toNumber(row.cache_tokens),
    outputTokensPerSec: null,
    latestUsedAt: toNumber(row.latest_used_at),
  }));

  const tokenDetailMap = new Map<string, TokenDetailData>();

  if (baseTokenRankings.length > 0) {
    const targetRows = baseTokenRankings.map((row) => ({
      tokenId: row.tokenId,
      tokenName: row.tokenName,
    }));
    const { values: detailValues, cteSql } = buildTokenTargetsCte(targetRows, values);
    const detailBaseSql = `
      WITH ${cteSql},
      filtered_logs AS (
        SELECT
          COALESCE(l.token_id, 0) AS token_id,
          COALESCE(NULLIF(l.token_name, ''), 'Unknown') AS token_name,
          ${normalizedModelSql} AS normalized_model,
          COALESCE(l.channel_id, 0) AS channel_id,
          l.channel_name,
          l.prompt_tokens,
          l.completion_tokens,
          l.other,
          l.created_at,
          ${cacheTokensSql} AS cache_tokens
        FROM logs l
        ${whereSql}
      ),
      matched_logs AS (
        SELECT filtered_logs.*
        FROM filtered_logs
        INNER JOIN target_tokens
          ON target_tokens.token_id = filtered_logs.token_id
         AND (target_tokens.token_id <> 0 OR target_tokens.token_name = filtered_logs.token_name)
      )
    `;

    const [tokenDetailSummaryResult, tokenDetailModelResult, tokenDetailChannelResult] = await Promise.all([
      query<{
        token_id: string | number;
        token_name: string;
        first_used_at: string | number;
        active_model_count: string | number;
        active_channel_count: string | number;
      }>(
        `${detailBaseSql}
          SELECT
            token_id,
            token_name,
            MIN(created_at) AS first_used_at,
            COUNT(DISTINCT normalized_model) FILTER (WHERE normalized_model <> 'Unknown') AS active_model_count,
            COUNT(DISTINCT channel_id) FILTER (WHERE channel_id <> 0) AS active_channel_count
          FROM matched_logs
          GROUP BY token_id, token_name
        `,
        detailValues,
      ),
      query<{
        token_id: string | number;
        token_name: string;
        model_name: string;
        request_count: string | number;
        input_tokens: string | number;
        output_tokens: string | number;
        total_tokens: string | number;
        cache_tokens: string | number;
        latest_used_at: string | number;
      }>(
        `${detailBaseSql},
          aggregated AS (
            SELECT
              token_id,
              token_name,
              normalized_model AS model_name,
              COUNT(*) AS request_count,
              COALESCE(SUM(${getInputTokensSql("matched_logs")}), 0) AS input_tokens,
              COALESCE(SUM(completion_tokens), 0) AS output_tokens,
              COALESCE(SUM(${getInputTokensSql("matched_logs")} + completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(cache_tokens), 0) AS cache_tokens,
              MAX(created_at) AS latest_used_at
            FROM matched_logs
            WHERE normalized_model <> 'Unknown'
            GROUP BY token_id, token_name, normalized_model
          ),
          ranked AS (
            SELECT
              aggregated.*,
              ROW_NUMBER() OVER (
                PARTITION BY token_id, token_name
                ORDER BY total_tokens DESC, request_count DESC
              ) AS row_number
            FROM aggregated
          )
          SELECT
            token_id,
            token_name,
            model_name,
            request_count,
            input_tokens,
            output_tokens,
            total_tokens,
            cache_tokens,
            latest_used_at
          FROM ranked
          WHERE row_number <= 6
          ORDER BY token_id ASC, token_name ASC, row_number ASC
        `,
        detailValues,
      ),
      query<{
        token_id: string | number;
        token_name: string;
        channel_id: string | number;
        channel_name: string;
        request_count: string | number;
        input_tokens: string | number;
        output_tokens: string | number;
        total_tokens: string | number;
        cache_tokens: string | number;
        latest_used_at: string | number;
      }>(
        `${detailBaseSql},
          aggregated AS (
            SELECT
              matched_logs.token_id,
              matched_logs.token_name,
              matched_logs.channel_id,
              COALESCE(
                NULLIF(channels.name, ''),
                MAX(NULLIF(matched_logs.channel_name, '')),
                CONCAT('渠道 ', matched_logs.channel_id::text)
              ) AS channel_name,
              COUNT(*) AS request_count,
              COALESCE(SUM(${getInputTokensSql("matched_logs")}), 0) AS input_tokens,
              COALESCE(SUM(matched_logs.completion_tokens), 0) AS output_tokens,
              COALESCE(SUM(${getInputTokensSql("matched_logs")} + matched_logs.completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(matched_logs.cache_tokens), 0) AS cache_tokens,
              MAX(matched_logs.created_at) AS latest_used_at
            FROM matched_logs
            LEFT JOIN channels ON channels.id = matched_logs.channel_id
            GROUP BY matched_logs.token_id, matched_logs.token_name, matched_logs.channel_id, channels.name
          ),
          ranked AS (
            SELECT
              aggregated.*,
              ROW_NUMBER() OVER (
                PARTITION BY token_id, token_name
                ORDER BY total_tokens DESC, request_count DESC
              ) AS row_number
            FROM aggregated
            WHERE channel_id <> 0
          )
          SELECT
            token_id,
            token_name,
            channel_id,
            channel_name,
            request_count,
            input_tokens,
            output_tokens,
            total_tokens,
            cache_tokens,
            latest_used_at
          FROM ranked
          WHERE row_number <= 6
          ORDER BY token_id ASC, token_name ASC, row_number ASC
        `,
        detailValues,
      ),
    ]);

    for (const row of baseTokenRankings) {
      tokenDetailMap.set(getTokenDetailKey(row.tokenId, row.tokenName), getDefaultTokenDetail());
    }

    for (const row of tokenDetailSummaryResult.rows) {
      const key = getTokenDetailKey(toNumber(row.token_id), String(row.token_name ?? ""));
      tokenDetailMap.set(key, {
        ...(tokenDetailMap.get(key) ?? getDefaultTokenDetail()),
        firstUsedAt: toNumber(row.first_used_at),
        activeModelCount: toNumber(row.active_model_count),
        activeChannelCount: toNumber(row.active_channel_count),
      });
    }

    for (const row of tokenDetailModelResult.rows) {
      const key = getTokenDetailKey(toNumber(row.token_id), String(row.token_name ?? ""));
      const current = tokenDetailMap.get(key) ?? getDefaultTokenDetail();
      current.models.push({
        modelName: String(row.model_name ?? ""),
        requestCount: toNumber(row.request_count),
        inputTokens: toNumber(row.input_tokens),
        outputTokens: toNumber(row.output_tokens),
        totalTokens: toNumber(row.total_tokens),
        cacheTokens: toNumber(row.cache_tokens),
        latestUsedAt: toNumber(row.latest_used_at),
      });
      tokenDetailMap.set(key, current);
    }

    for (const row of tokenDetailChannelResult.rows) {
      const key = getTokenDetailKey(toNumber(row.token_id), String(row.token_name ?? ""));
      const current = tokenDetailMap.get(key) ?? getDefaultTokenDetail();
      current.channels.push({
        channelId: toNumber(row.channel_id),
        channelName: String(row.channel_name ?? ""),
        requestCount: toNumber(row.request_count),
        inputTokens: toNumber(row.input_tokens),
        outputTokens: toNumber(row.output_tokens),
        totalTokens: toNumber(row.total_tokens),
        cacheTokens: toNumber(row.cache_tokens),
        latestUsedAt: toNumber(row.latest_used_at),
      });
      tokenDetailMap.set(key, current);
    }
  }

  return {
    minTimestamp,
    maxTimestamp,
    generatedAt: Date.now(),
    filters,
    summary: {
      requestCount: toNumber(summaryRow?.request_count),
      inputTokens: toNumber(summaryRow?.input_tokens),
      outputTokens: toNumber(summaryRow?.output_tokens),
      totalTokens: toNumber(summaryRow?.total_tokens),
      cacheTokens: toNumber(summaryRow?.cache_tokens),
      avgOutputTokensPerSec: getNullableNumber(summaryRow?.avg_output_tokens_per_sec),
      activeUserCount: toNumber(summaryRow?.active_user_count),
      activeChannelCount: toNumber(summaryRow?.active_channel_count),
    },
    stabilitySummary: {
      totalAttempts: toNumber(stabilitySummaryRow?.total_attempts),
      successCount: toNumber(stabilitySummaryRow?.success_count),
      errorCount: toNumber(stabilitySummaryRow?.error_count),
      errorRate: getNullableNumber(stabilitySummaryRow?.error_rate),
      avgFirstTokenLatency: getNullableNumber(stabilitySummaryRow?.avg_first_token_latency),
      avgTotalResponseTime: getNullableNumber(stabilitySummaryRow?.avg_total_response_time),
    },
    tokenRankings: baseTokenRankings.map((row) => ({
      ...row,
      detail: tokenDetailMap.get(getTokenDetailKey(row.tokenId, row.tokenName)) ?? getDefaultTokenDetail(),
    })),
    userRankings: userResult.rows.map((row) => ({
      userId: toNumber(row.user_id),
      username: String(row.username ?? ""),
      displayName: String(row.display_name ?? ""),
      status: toNumber(row.status, -1),
      requestCount: toNumber(row.request_count),
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      totalTokens: toNumber(row.total_tokens),
      cacheTokens: toNumber(row.cache_tokens),
      outputTokensPerSec: null,
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    modelRankings: modelResult.rows.map((row) => ({
      modelName: String(row.model_name ?? ""),
      requestCount: toNumber(row.request_count),
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      totalTokens: toNumber(row.total_tokens),
      cacheTokens: toNumber(row.cache_tokens),
      outputTokensPerSec: getNullableNumber(row.output_tokens_per_sec),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    channelRankings: channelResult.rows.map((row) => ({
      channelId: toNumber(row.channel_id),
      channelName: String(row.channel_name ?? ""),
      type: toNumber(row.type, -1),
      status: toNumber(row.status, -1),
      requestCount: toNumber(row.request_count),
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      totalTokens: toNumber(row.total_tokens),
      cacheTokens: toNumber(row.cache_tokens),
      outputTokensPerSec: getNullableNumber(row.output_tokens_per_sec),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    modelStability: modelStabilityResult.rows.map((row) => ({
      modelName: String(row.model_name ?? ""),
      totalAttempts: toNumber(row.total_attempts),
      successCount: toNumber(row.success_count),
      errorCount: toNumber(row.error_count),
      errorRate: toNumber(row.error_rate),
      avgFirstTokenLatency: getNullableNumber(row.avg_first_token_latency),
      avgTotalResponseTime: getNullableNumber(row.avg_total_response_time),
      avgOutputTokensPerSec: getNullableNumber(row.avg_output_tokens_per_sec),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    channelStability: channelStabilityResult.rows.map((row) => ({
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
    })),
    trend: trendResult.rows.map((row) => ({
      bucketTs: toNumber(row.bucket_ts),
      requestCount: toNumber(row.request_count),
      inputTokens: toNumber(row.input_tokens),
      outputTokens: toNumber(row.output_tokens),
      totalTokens: toNumber(row.total_tokens),
      cacheTokens: toNumber(row.cache_tokens),
    })),
    usernameOptions: usernameOptionResult.rows.map((row) => ({
      value: String(row.username ?? ""),
      label: String(row.username ?? ""),
    })),
    modelOptions: modelOptionResult.rows.map((row) => ({
      value: String(row.model_name ?? ""),
      label: String(row.model_name ?? ""),
    })),
    channelOptions: channelOptionResult.rows.map((row) => ({
      value: String(row.id),
      label: row.label,
    })),
  };
}
