import { query } from "@/lib/db";

const PRESET_SECONDS = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
} as const;

type FixedPreset = keyof typeof PRESET_SECONDS;

export type FilterPreset = FixedPreset | "custom" | "all";
export type TrendGranularity = "hour" | "day";
export type SearchParamsInput = Record<string, string | string[] | undefined>;

export interface DashboardFilters {
  preset: FilterPreset;
  token: string;
  username: string;
  model: string;
  channelId: string;
  startDate: string;
  endDate: string;
  startTimestamp: number | null;
  endTimestamp: number | null;
  granularity: TrendGranularity;
  windowLabel: string;
}

export interface SummaryMetrics {
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
  activeTokenCount: number;
  activeUserCount: number;
  activeChannelCount: number;
}

export interface TokenDetailModelRow {
  modelName: string;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
  latestUsedAt: number;
}

export interface TokenDetailChannelRow {
  channelId: number;
  channelName: string;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
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
  remainQuota: number;
  usedQuota: number;
  unlimitedQuota: boolean;
  expiredTime: number;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
  latestUsedAt: number;
  detail: TokenDetailData;
}

export interface UserRankingRow {
  userId: number;
  username: string;
  displayName: string;
  status: number;
  accountQuota: number;
  accountUsedQuota: number;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
  latestUsedAt: number;
}

export interface ModelRankingRow {
  modelName: string;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
  latestUsedAt: number;
}

export interface ChannelRankingRow {
  channelId: number;
  channelName: string;
  type: number;
  status: number;
  balance: number;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
  latestUsedAt: number;
}

export interface TrendPoint {
  bucketTs: number;
  requestCount: number;
  totalTokens: number;
  totalQuota: number;
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
  tokenRankings: TokenRankingRow[];
  userRankings: UserRankingRow[];
  modelRankings: ModelRankingRow[];
  channelRankings: ChannelRankingRow[];
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

function parseDateInput(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const suffix = endOfDay ? "T23:59:59" : "T00:00:00";
  const timestamp = Date.parse(`${value}${suffix}`);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor(timestamp / 1000);
}

function formatDateInput(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function getWindowLabel(
  preset: FilterPreset,
  startTimestamp: number | null,
  endTimestamp: number | null,
) {
  if (preset === "all") {
    return "全部时间";
  }

  if (preset === "custom" && startTimestamp && endTimestamp) {
    return `${formatDateInput(startTimestamp)} 至 ${formatDateInput(endTimestamp)}`;
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
    rawPreset === "24h" || rawPreset === "7d" || rawPreset === "30d" || rawPreset === "custom" || rawPreset === "all"
      ? rawPreset
      : "7d";

  const token = cleanText(getFirstValue(searchParams.token));
  const username = cleanText(getFirstValue(searchParams.username), 64);
  const model = cleanText(normalizeModelName(getFirstValue(searchParams.model)), 128);
  const channelId = cleanText(getFirstValue(searchParams.channelId), 20);
  const startDate = cleanText(getFirstValue(searchParams.start), 10);
  const endDate = cleanText(getFirstValue(searchParams.end), 10);

  let startTimestamp: number | null = null;
  let endTimestamp: number | null = maxTimestamp;

  if (preset === "custom") {
    startTimestamp = parseDateInput(startDate, false) ?? minTimestamp;
    endTimestamp = parseDateInput(endDate, true) ?? maxTimestamp;
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
    startDate,
    endDate,
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

  const [summaryResult, tokenResult, userResult, modelResult, channelResult, trendResult, usernameOptionResult, modelOptionResult, channelOptionResult] =
    await Promise.all([
      query<{
        request_count: string | number;
        total_tokens: string | number;
        total_quota: string | number;
        active_token_count: string | number;
        active_user_count: string | number;
        active_channel_count: string | number;
      }>(
        `
          SELECT
            COUNT(*) AS request_count,
            COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0) AS total_tokens,
            COALESCE(SUM(l.quota), 0) AS total_quota,
            COUNT(DISTINCT NULLIF(l.token_id, 0)) AS active_token_count,
            COUNT(DISTINCT l.user_id) AS active_user_count,
            COUNT(DISTINCT l.channel_id) AS active_channel_count
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
        remain_quota: string | number;
        used_quota: string | number;
        unlimited_quota: boolean | null;
        expired_time: string | number;
        request_count: string | number;
        total_tokens: string | number;
        total_quota: string | number;
        latest_used_at: string | number;
      }>(
        `
          WITH filtered_logs AS (
            SELECT
              l.token_id,
              l.token_name,
              l.user_id,
              l.username,
              l.quota,
              l.prompt_tokens,
              l.completion_tokens,
              l.created_at
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
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(quota), 0) AS total_quota,
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
            COALESCE(tokens.remain_quota, 0) AS remain_quota,
            COALESCE(tokens.used_quota, 0) AS used_quota,
            COALESCE(tokens.unlimited_quota, false) AS unlimited_quota,
            COALESCE(tokens.expired_time, -1) AS expired_time,
            aggregated.request_count,
            aggregated.total_tokens,
            aggregated.total_quota,
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
        account_quota: string | number;
        account_used_quota: string | number;
        request_count: string | number;
        total_tokens: string | number;
        total_quota: string | number;
        latest_used_at: string | number;
      }>(
        `
          WITH filtered_logs AS (
            SELECT l.user_id, l.username, l.quota, l.prompt_tokens, l.completion_tokens, l.created_at
            FROM logs l
            ${whereSql}
          ),
          aggregated AS (
            SELECT
              COALESCE(user_id, 0) AS user_id,
              COALESCE(NULLIF(username, ''), 'Unknown') AS log_username,
              COUNT(*) AS request_count,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(quota), 0) AS total_quota,
              MAX(created_at) AS latest_used_at
            FROM filtered_logs
            GROUP BY COALESCE(user_id, 0), COALESCE(NULLIF(username, ''), 'Unknown')
          )
          SELECT
            aggregated.user_id,
            COALESCE(users.username, aggregated.log_username, 'Unknown') AS username,
            COALESCE(users.display_name, '') AS display_name,
            COALESCE(users.status, -1) AS status,
            COALESCE(users.quota, 0) AS account_quota,
            COALESCE(users.used_quota, 0) AS account_used_quota,
            aggregated.request_count,
            aggregated.total_tokens,
            aggregated.total_quota,
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
        total_tokens: string | number;
        total_quota: string | number;
        latest_used_at: string | number;
      }>(
        `
          SELECT
            ${normalizedModelSql} AS model_name,
            COUNT(*) AS request_count,
            COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0) AS total_tokens,
            COALESCE(SUM(l.quota), 0) AS total_quota,
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
        balance: string | number | null;
        request_count: string | number;
        total_tokens: string | number;
        total_quota: string | number;
        latest_used_at: string | number;
      }>(
        `
          WITH filtered_logs AS (
            SELECT
              l.channel_id,
              l.channel_name,
              l.quota,
              l.prompt_tokens,
              l.completion_tokens,
              l.created_at
            FROM logs l
            ${whereSql}
          ),
          aggregated AS (
            SELECT
              COALESCE(channel_id, 0) AS channel_id,
              MAX(NULLIF(channel_name, '')) AS log_channel_name,
              COUNT(*) AS request_count,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(quota), 0) AS total_quota,
              MAX(created_at) AS latest_used_at
            FROM filtered_logs
            GROUP BY COALESCE(channel_id, 0)
          )
          SELECT
            aggregated.channel_id,
            COALESCE(NULLIF(channels.name, ''), aggregated.log_channel_name, CONCAT('渠道 ', aggregated.channel_id::text)) AS channel_name,
            COALESCE(channels.type, -1) AS type,
            COALESCE(channels.status, -1) AS status,
            channels.balance,
            aggregated.request_count,
            aggregated.total_tokens,
            aggregated.total_quota,
            aggregated.latest_used_at
          FROM aggregated
          LEFT JOIN channels ON channels.id = aggregated.channel_id
          ORDER BY aggregated.total_tokens DESC, aggregated.request_count DESC
          LIMIT 12
        `,
        values,
      ),
      query<{
        bucket_ts: string | number;
        request_count: string | number;
        total_tokens: string | number;
        total_quota: string | number;
      }>(
        `
          SELECT
            EXTRACT(EPOCH FROM date_trunc('${trendBucket}', to_timestamp(l.created_at))) AS bucket_ts,
            COUNT(*) AS request_count,
            COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0) AS total_tokens,
            COALESCE(SUM(l.quota), 0) AS total_quota
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
  const baseTokenRankings = tokenResult.rows.map((row) => ({
    tokenId: toNumber(row.token_id),
    tokenName: row.token_name,
    username: row.username,
    displayName: row.display_name,
    status: toNumber(row.status, -1),
    remainQuota: toNumber(row.remain_quota),
    usedQuota: toNumber(row.used_quota),
    unlimitedQuota: row.unlimited_quota === true,
    expiredTime: toNumber(row.expired_time, -1),
    requestCount: toNumber(row.request_count),
    totalTokens: toNumber(row.total_tokens),
    totalQuota: toNumber(row.total_quota),
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
          l.quota,
          l.prompt_tokens,
          l.completion_tokens,
          l.created_at
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
        total_tokens: string | number;
        total_quota: string | number;
        latest_used_at: string | number;
      }>(
        `${detailBaseSql},
          aggregated AS (
            SELECT
              token_id,
              token_name,
              normalized_model AS model_name,
              COUNT(*) AS request_count,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(quota), 0) AS total_quota,
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
            total_tokens,
            total_quota,
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
        total_tokens: string | number;
        total_quota: string | number;
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
              COALESCE(SUM(matched_logs.prompt_tokens + matched_logs.completion_tokens), 0) AS total_tokens,
              COALESCE(SUM(matched_logs.quota), 0) AS total_quota,
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
            total_tokens,
            total_quota,
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
        totalTokens: toNumber(row.total_tokens),
        totalQuota: toNumber(row.total_quota),
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
        totalTokens: toNumber(row.total_tokens),
        totalQuota: toNumber(row.total_quota),
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
      totalTokens: toNumber(summaryRow?.total_tokens),
      totalQuota: toNumber(summaryRow?.total_quota),
      activeTokenCount: toNumber(summaryRow?.active_token_count),
      activeUserCount: toNumber(summaryRow?.active_user_count),
      activeChannelCount: toNumber(summaryRow?.active_channel_count),
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
      accountQuota: toNumber(row.account_quota),
      accountUsedQuota: toNumber(row.account_used_quota),
      requestCount: toNumber(row.request_count),
      totalTokens: toNumber(row.total_tokens),
      totalQuota: toNumber(row.total_quota),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    modelRankings: modelResult.rows.map((row) => ({
      modelName: row.model_name,
      requestCount: toNumber(row.request_count),
      totalTokens: toNumber(row.total_tokens),
      totalQuota: toNumber(row.total_quota),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    channelRankings: channelResult.rows.map((row) => ({
      channelId: toNumber(row.channel_id),
      channelName: row.channel_name,
      type: toNumber(row.type, -1),
      status: toNumber(row.status, -1),
      balance: toNumber(row.balance),
      requestCount: toNumber(row.request_count),
      totalTokens: toNumber(row.total_tokens),
      totalQuota: toNumber(row.total_quota),
      latestUsedAt: toNumber(row.latest_used_at),
    })),
    trend: trendResult.rows.map((row) => ({
      bucketTs: toNumber(row.bucket_ts),
      requestCount: toNumber(row.request_count),
      totalTokens: toNumber(row.total_tokens),
      totalQuota: toNumber(row.total_quota),
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
