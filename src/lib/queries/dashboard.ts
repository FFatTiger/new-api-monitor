import { query } from "@/lib/db";

const PRESET_SECONDS = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
} as const;

type FixedPreset = keyof typeof PRESET_SECONDS;

export type FilterPreset = "today" | FixedPreset | "custom" | "all";
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
  activeTokenCount: number;
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
  detail: TokenDetailData;
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

function getFirstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
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

function cleanText(value: string, maxLength = 100) {
  return value.trim().slice(0, maxLength);
}

function normalizeModelName(value: string) {
  return value.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function getNormalizedModelSql(expression: string) {
  return `COALESCE(NULLIF(BTRIM(regexp_replace(COALESCE(${expression}, ''), '\\s*\\([^)]*\\)$', '')), ''), 'Unknown')`;
}

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const shanghaiDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shanghaiDateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getShanghaiDateParts(date: Date) {
  const parts = shanghaiDatePartsFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");

  return { year, month, day };
}

function getShanghaiDateTimeParts(date: Date) {
  const parts = shanghaiDateTimePartsFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return { year, month, day, hour, minute };
}

function parseShanghaiDateTimeInput(value: string, endOfMinute = false) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const baseUtcSeconds = Date.UTC(year, month - 1, day, hour, minute, 0) / 1000;

  return baseUtcSeconds - 8 * 60 * 60 + (endOfMinute ? 59 : 0);
}

function formatDateTimeInput(timestamp: number) {
  const { year, month, day, hour, minute } = getShanghaiDateTimeParts(new Date(timestamp * 1000));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getTodayRangeInShanghai() {
  const { year, month, day } = getShanghaiDateParts(new Date());
  const dateString = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    startInput: `${dateString}T00:00`,
    endInput: `${dateString}T23:59`,
    startTimestamp: parseShanghaiDateTimeInput(`${dateString}T00:00`, false),
    endTimestamp: parseShanghaiDateTimeInput(`${dateString}T23:59`, true),
  };
}

function getWindowLabel(
  preset: FilterPreset,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  if (preset === "all") {
    return "全部时间";
  }

  if (preset === "today") {
    return "今天";
  }

  if (preset === "custom" && startTimestamp && endTimestamp) {
    return `${formatDateTimeInput(startTimestamp)} 至 ${formatDateTimeInput(endTimestamp)}`;
  }

  if (preset === "24h") {
    return "近 24 小时";
  }

  if (preset === "30d") {
    return "近 30 天";
  }

  return "近 7 天";
}

function parseFilters(searchParams: SearchParamsInput, minTimestamp: number, maxTimestamp: number): DashboardFilters {
  const rawPreset = getFirstValue(searchParams.preset);
  const preset: FilterPreset =
    rawPreset === "today" || rawPreset === "24h" || rawPreset === "7d" || rawPreset === "30d" || rawPreset === "custom" || rawPreset === "all"
      ? rawPreset
      : "today";

  const token = cleanText(getFirstValue(searchParams.token));
  const username = cleanText(getFirstValue(searchParams.username), 64);
  const model = cleanText(normalizeModelName(getFirstValue(searchParams.model)), 128);
  const channelId = cleanText(getFirstValue(searchParams.channelId), 20);
  const startInput = cleanText(getFirstValue(searchParams.start), 16);
  const endInput = cleanText(getFirstValue(searchParams.end), 16);
  const todayRange = getTodayRangeInShanghai();

  let startTimestamp: number | null = null;
  let endTimestamp: number | null = maxTimestamp;

  if (preset === "today") {
    startTimestamp = todayRange.startTimestamp ?? minTimestamp;
    endTimestamp = todayRange.endTimestamp ?? maxTimestamp;
  } else if (preset === "custom") {
    startTimestamp = parseShanghaiDateTimeInput(startInput, false) ?? minTimestamp;
    endTimestamp = parseShanghaiDateTimeInput(endInput, true) ?? maxTimestamp;
  } else if (preset === "all") {
    startTimestamp = null;
    endTimestamp = null;
  } else {
    startTimestamp = maxTimestamp - PRESET_SECONDS[preset];
  }

  if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
    [startTimestamp, endTimestamp] = [endTimestamp, startTimestamp];
  }

  const rangeSeconds =
    startTimestamp !== null && endTimestamp !== null
      ? Math.max(endTimestamp - startTimestamp, 0)
      : Math.max(maxTimestamp - minTimestamp, 0);
  const granularity: TrendGranularity = rangeSeconds <= 2 * 24 * 60 * 60 ? "hour" : "day";

  return {
    preset,
    token,
    username,
    model,
    channelId,
    startInput: preset === "today" ? todayRange.startInput : startInput,
    endInput: preset === "today" ? todayRange.endInput : endInput,
    startTimestamp,
    endTimestamp,
    granularity,
    windowLabel: getWindowLabel(preset, startTimestamp, endTimestamp),
  };
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

export async function getDashboardData(searchParams: SearchParamsInput = {}): Promise<DashboardData> {
  const timeBoundsResult = await query<TimeBoundsRow>(
    "SELECT MIN(created_at) AS min_ts, MAX(created_at) AS max_ts FROM logs",
  );

  const timeBounds = timeBoundsResult.rows[0];
  const minTimestamp = toNumber(timeBounds?.min_ts);
  const maxTimestamp = toNumber(timeBounds?.max_ts);

  if (!maxTimestamp) {
    throw new Error("No log data available in the database.");
  }

  const filters = parseFilters(searchParams, minTimestamp, maxTimestamp);
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
      active_token_count: string | number;
      active_user_count: string | number;
      active_channel_count: string | number;
    }>(
      `
        SELECT
          COUNT(*) AS request_count,
          COALESCE(SUM(l.prompt_tokens + ${cacheTokensSql}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(l.prompt_tokens + l.completion_tokens + ${cacheTokensSql}), 0) AS total_tokens,
          COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens,
          COUNT(DISTINCT NULLIF(l.token_id, 0)) AS active_token_count,
          COUNT(DISTINCT l.user_id) AS active_user_count,
          COUNT(DISTINCT l.channel_id) AS active_channel_count
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
            COALESCE(SUM(prompt_tokens + cache_tokens), 0) AS input_tokens,
            COALESCE(SUM(completion_tokens), 0) AS output_tokens,
            COALESCE(SUM(prompt_tokens + completion_tokens + cache_tokens), 0) AS total_tokens,
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
          SELECT l.user_id, l.username, l.prompt_tokens, l.completion_tokens, l.created_at, ${cacheTokensSql} AS cache_tokens
          FROM logs l
          ${whereSql}
        ),
        aggregated AS (
          SELECT
            COALESCE(user_id, 0) AS user_id,
            COALESCE(NULLIF(username, ''), 'Unknown') AS log_username,
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens + cache_tokens), 0) AS input_tokens,
            COALESCE(SUM(completion_tokens), 0) AS output_tokens,
            COALESCE(SUM(prompt_tokens + completion_tokens + cache_tokens), 0) AS total_tokens,
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
          COALESCE(SUM(l.prompt_tokens + ${cacheTokensSql}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(l.prompt_tokens + l.completion_tokens + ${cacheTokensSql}), 0) AS total_tokens,
          COALESCE(SUM(${cacheTokensSql}), 0) AS cache_tokens,
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS output_tokens_per_sec,
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
            COALESCE(SUM(prompt_tokens + cache_tokens), 0) AS input_tokens,
            COALESCE(SUM(completion_tokens), 0) AS output_tokens,
            COALESCE(SUM(prompt_tokens + completion_tokens + cache_tokens), 0) AS total_tokens,
            COALESCE(SUM(cache_tokens), 0) AS cache_tokens,
            AVG(CASE WHEN type = 2 AND use_time > 0 THEN completion_tokens::numeric / NULLIF(use_time, 0) END) AS output_tokens_per_sec,
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
          AVG(CASE WHEN l.type = 2 AND l.use_time > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec,
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
            AVG(CASE WHEN l.type = 2 AND l.use_time > 0 THEN l.completion_tokens::numeric / NULLIF(l.use_time, 0) END) AS avg_output_tokens_per_sec,
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
          COALESCE(SUM(l.prompt_tokens + ${cacheTokensSql}), 0) AS input_tokens,
          COALESCE(SUM(l.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(l.prompt_tokens + l.completion_tokens + ${cacheTokensSql}), 0) AS total_tokens,
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
    tokenName: row.token_name,
    username: row.username,
    displayName: row.display_name,
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
              COALESCE(SUM(prompt_tokens + cache_tokens), 0) AS input_tokens,
              COALESCE(SUM(completion_tokens), 0) AS output_tokens,
              COALESCE(SUM(prompt_tokens + completion_tokens + cache_tokens), 0) AS total_tokens,
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
              COALESCE(SUM(matched_logs.prompt_tokens + matched_logs.cache_tokens), 0) AS input_tokens,
              COALESCE(SUM(matched_logs.completion_tokens), 0) AS output_tokens,
              COALESCE(SUM(matched_logs.prompt_tokens + matched_logs.completion_tokens + matched_logs.cache_tokens), 0) AS total_tokens,
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
      const key = getTokenDetailKey(toNumber(row.token_id), row.token_name);
      tokenDetailMap.set(key, {
        ...(tokenDetailMap.get(key) ?? getDefaultTokenDetail()),
        firstUsedAt: toNumber(row.first_used_at),
        activeModelCount: toNumber(row.active_model_count),
        activeChannelCount: toNumber(row.active_channel_count),
      });
    }

    for (const row of tokenDetailModelResult.rows) {
      const key = getTokenDetailKey(toNumber(row.token_id), row.token_name);
      const current = tokenDetailMap.get(key) ?? getDefaultTokenDetail();
      current.models.push({
        modelName: row.model_name,
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
      const key = getTokenDetailKey(toNumber(row.token_id), row.token_name);
      const current = tokenDetailMap.get(key) ?? getDefaultTokenDetail();
      current.channels.push({
        channelId: toNumber(row.channel_id),
        channelName: row.channel_name,
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
      activeTokenCount: toNumber(summaryRow?.active_token_count),
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
      username: row.username,
      displayName: row.display_name,
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
      modelName: row.model_name,
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
      channelName: row.channel_name,
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
      modelName: row.model_name,
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
      channelName: row.channel_name,
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
      value: row.username,
      label: row.username,
    })),
    modelOptions: modelOptionResult.rows.map((row) => ({
      value: row.model_name,
      label: row.model_name,
    })),
    channelOptions: channelOptionResult.rows.map((row) => ({
      value: String(row.id),
      label: row.label,
    })),
  };
}
