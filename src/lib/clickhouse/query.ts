import type { ClickHouseClient, QueryParams } from "@clickhouse/client";

import { parseDashboardRouteFilters } from "@/lib/dashboard/dashboard-routing";
import type {
  ChannelRankingRow, ChannelStabilityRow, DashboardFilters, FilterOption,
  ModelRankingRow, ModelStabilityRow, SearchParamsInput, StabilitySummary,
  SummaryMetrics, TokenDetailData, TokenRankingRow, TrendPoint, UserRankingRow,
} from "@/lib/queries/dashboard";
import type { DashboardRollupPacket } from "@/lib/dashboard/rollup-query";

import { getClickHouseClient } from "./client.ts";
import { getClickHouseConfig } from "./config.ts";
import { ensureClickHouseSchema } from "./schema.ts";

const SAFE_DISABLED = "ClickHouse 统计尚未启用。页面不会回退执行 PostgreSQL 原始日志聚合。";
const SAFE_SYNCING = "ClickHouse 统计正在同步或暂时不可用。页面不会回退执行 PostgreSQL 原始日志聚合。";

export class ClickHouseQueryBusyError extends Error {
  constructor(message: "CLICKHOUSE_QUERY_BUSY" | "CLICKHOUSE_QUERY_QUEUE_TIMEOUT") {
    super(message);
    this.name = "ClickHouseQueryBusyError";
  }
}

export type ClickHousePacketResult =
  | { kind: "ready"; data: DashboardRollupPacket }
  | { kind: "error"; safeMessage: string };

class QueryGate {
  private active = 0;
  private waiting: Array<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];
  async run<T>(task: () => Promise<T>): Promise<T> {
    const config = getClickHouseConfig();
    if (this.active >= config.maxConcurrentQueries) {
      if (this.waiting.length >= config.maxQueuedQueries) throw new ClickHouseQueryBusyError("CLICKHOUSE_QUERY_BUSY");
      await new Promise<void>((resolve, reject) => {
        const item = { resolve, reject, timer: setTimeout(() => {
          this.waiting = this.waiting.filter((candidate) => candidate !== item);
          reject(new ClickHouseQueryBusyError("CLICKHOUSE_QUERY_QUEUE_TIMEOUT"));
        }, 1_000) };
        this.waiting.push(item);
      });
    }
    this.active += 1;
    try { return await task(); }
    finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) { clearTimeout(next.timer); next.resolve(); }
    }
  }
}
const gate = new QueryGate();

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nullableDivide(sum: unknown, count: unknown): number | null {
  const c = num(count); return c > 0 ? num(sum) / c : null;
}

interface Bounds { minTimestamp: number; maxTimestamp: number; }
async function jsonQuery<T>(client: ClickHouseClient, params: QueryParams): Promise<T[]> {
  return gate.run(async () => {
    const result = await client.query({
      ...params,
      format: "JSONEachRow",
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    return result.json<T>();
  });
}

export async function getClickHouseBounds(): Promise<Bounds | null> {
  const config = getClickHouseConfig();
  if (!config.readsEnabled) return null;
  const client = getClickHouseClient();
  await ensureClickHouseSchema(client);
  const rows = await jsonQuery<{ min_ts: string; max_ts: string }>(client, {
    query: `SELECT min(synced_min_created_at) AS min_ts, max(synced_max_created_at) AS max_ts
      FROM dashboard_sync_state WHERE singleton = 1`,
  });
  const minTimestamp = num(rows[0]?.min_ts);
  const maxTimestamp = num(rows[0]?.max_ts);
  return maxTimestamp > 0 ? { minTimestamp, maxTimestamp } : null;
}

export async function resolveClickHouseFilters(searchParams: SearchParamsInput): Promise<DashboardFilters | null> {
  const bounds = await getClickHouseBounds();
  if (!bounds) return null;
  return parseDashboardRouteFilters(searchParams, bounds);
}

export interface ClickHouseShellData {
  minTimestamp: number; maxTimestamp: number; generatedAt: number; filters: DashboardFilters;
  usernameOptions: FilterOption[]; modelOptions: FilterOption[]; channelOptions: FilterOption[];
}

export async function getClickHouseShellData(searchParams: SearchParamsInput): Promise<ClickHouseShellData | null> {
  try {
    const bounds = await getClickHouseBounds();
    if (!bounds) return null;
    const filters = parseDashboardRouteFilters(searchParams, bounds);
    const client = getClickHouseClient();
    const options = await jsonQuery<{ kind: string; value: string; label: string }>(client, {
      query: `SELECT kind, value, argMax(label, version) AS label
        FROM dashboard_dimensions GROUP BY kind, value ORDER BY kind, label LIMIT 5000`,
    });
    const select = (kind: string) => options.filter((row) => row.kind === kind).map(({ value, label }) => ({ value, label }));
    return { ...bounds, generatedAt: Date.now(), filters, usernameOptions: select("user"), modelOptions: select("model"), channelOptions: select("channel") };
  } catch (error) {
    console.error("[clickhouse-query] shell failed", error);
    return null;
  }
}

function rangeAndFilters(filters: DashboardFilters): { where: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.startTimestamp !== null) { clauses.push("bucket_start >= {start:UInt64}"); params.start = Math.floor(filters.startTimestamp / 60) * 60; }
  if (filters.endTimestamp !== null) { clauses.push("bucket_start <= {end:UInt64}"); params.end = Math.floor(filters.endTimestamp / 60) * 60; }
  if (filters.token) { clauses.push("positionCaseInsensitiveUTF8(token_name, {token:String}) > 0"); params.token = filters.token; }
  if (filters.username) { clauses.push("username = {username:String}"); params.username = filters.username; }
  if (filters.model) { clauses.push("model_name = {model:String}"); params.model = filters.model; }
  if (filters.channelId) { clauses.push("channel_id = {channel:UInt64}"); params.channel = filters.channelId; }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function dedupCte(filters: DashboardFilters): { sql: string; params: Record<string, unknown> } {
  const { where, params } = rangeAndFilters(filters);
  return { params, sql: `dedup AS (
    SELECT batch_id, bucket_start, token_id, token_name, user_id, username, model_name, channel_id,
      argMax(channel_name, version) channel_name,
      argMax(request_count, version) request_count, argMax(input_tokens, version) input_tokens,
      argMax(output_tokens, version) output_tokens, argMax(cache_tokens, version) cache_tokens,
      argMax(attempt_count, version) attempt_count, argMax(success_count, version) success_count,
      argMax(error_count, version) error_count,
      argMax(first_token_latency_sum, version) first_token_latency_sum,
      argMax(first_token_latency_count, version) first_token_latency_count,
      argMax(response_time_sum, version) response_time_sum, argMax(response_time_count, version) response_time_count,
      argMax(output_speed_sum, version) output_speed_sum, argMax(output_speed_count, version) output_speed_count,
      argMax(first_used_at, version) first_used_at, argMax(latest_used_at, version) latest_used_at
    FROM dashboard_minute_batches ${where}
    GROUP BY batch_id, bucket_start, token_id, token_name, user_id, username, model_name, channel_id
  )` };
}

export async function getClickHouseDashboardPacket(filters: DashboardFilters): Promise<ClickHousePacketResult> {
  const config = getClickHouseConfig();
  if (!config.readsEnabled) return { kind: "error", safeMessage: SAFE_DISABLED };
  try {
    const bounds = await getClickHouseBounds();
    if (!bounds) return { kind: "error", safeMessage: SAFE_SYNCING };
    const client = getClickHouseClient();
    const cte = dedupCte(filters);
    const common = { query_params: cte.params };
    const summaryPromise = jsonQuery<Record<string, unknown>>(client, { ...common, query: `WITH ${cte.sql} SELECT
      sum(request_count) request_count, sum(input_tokens) input_tokens, sum(output_tokens) output_tokens,
      sum(input_tokens + output_tokens) total_tokens, sum(cache_tokens) cache_tokens,
      sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count,
      uniqExactIf(user_id, user_id != 0) active_users, uniqExactIf(channel_id, channel_id != 0) active_channels,
      sum(attempt_count) attempts, sum(success_count) successes, sum(error_count) errors,
      sum(first_token_latency_sum) frt_sum, sum(first_token_latency_count) frt_count,
      sum(response_time_sum) response_sum, sum(response_time_count) response_count FROM dedup` });
    const rankingsPromise = jsonQuery<Record<string, unknown>>(client, { ...common, query: `WITH ${cte.sql}, ranked AS (
      SELECT * FROM (SELECT 'token' kind, toString(token_id) id, token_name name, max(username) secondary, sum(request_count) requests, sum(input_tokens) input,
        sum(output_tokens) output, sum(input_tokens+output_tokens) total, sum(cache_tokens) cache, sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count, max(latest_used_at) latest FROM dedup GROUP BY token_id, token_name ORDER BY total DESC LIMIT 12)
      UNION ALL SELECT * FROM (SELECT 'user' kind, toString(user_id) id, username name, '' secondary, sum(request_count) requests, sum(input_tokens) input, sum(output_tokens) output, sum(input_tokens+output_tokens) total, sum(cache_tokens) cache, sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count, max(latest_used_at) latest FROM dedup GROUP BY user_id, username ORDER BY total DESC LIMIT 12)
      UNION ALL SELECT * FROM (SELECT 'model' kind, '0' id, model_name name, '' secondary, sum(request_count) requests, sum(input_tokens) input, sum(output_tokens) output, sum(input_tokens+output_tokens) total, sum(cache_tokens) cache, sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count, max(latest_used_at) latest FROM dedup GROUP BY model_name ORDER BY total DESC LIMIT 12)
      UNION ALL SELECT * FROM (SELECT 'channel' kind, toString(channel_id) id, if(max(channel_name)='', concat('渠道 ',toString(channel_id)),max(channel_name)) name, '' secondary, sum(request_count) requests, sum(input_tokens) input, sum(output_tokens) output, sum(input_tokens+output_tokens) total, sum(cache_tokens) cache, sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count, max(latest_used_at) latest FROM dedup GROUP BY channel_id ORDER BY total DESC LIMIT 12)
    ) SELECT * FROM ranked` });
    const stabilityPromise = jsonQuery<Record<string, unknown>>(client, { ...common, query: `WITH ${cte.sql}, stable AS (
      SELECT * FROM (SELECT 'model' kind, '0' id, model_name name, sum(attempt_count) attempts, sum(success_count) successes, sum(error_count) errors, sum(first_token_latency_sum) frt_sum, sum(first_token_latency_count) frt_count, sum(response_time_sum) response_sum, sum(response_time_count) response_count, sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count, max(latest_used_at) latest FROM dedup GROUP BY model_name HAVING attempts > 0 ORDER BY errors/attempts DESC LIMIT 12)
      UNION ALL SELECT * FROM (SELECT 'channel' kind, toString(channel_id) id, if(max(channel_name)='',concat('渠道 ',toString(channel_id)),max(channel_name)) name, sum(attempt_count) attempts, sum(success_count) successes, sum(error_count) errors, sum(first_token_latency_sum) frt_sum, sum(first_token_latency_count) frt_count, sum(response_time_sum) response_sum, sum(response_time_count) response_count, sum(output_speed_sum) speed_sum, sum(output_speed_count) speed_count, max(latest_used_at) latest FROM dedup GROUP BY channel_id HAVING attempts > 0 ORDER BY errors/attempts DESC LIMIT 12)
    ) SELECT * FROM stable` });
    const bucket = filters.granularity === "hour" ? "toStartOfHour(toDateTime(bucket_start, 'Asia/Shanghai'))" : "toStartOfDay(toDateTime(bucket_start, 'Asia/Shanghai'), 'Asia/Shanghai')";
    const trendPromise = jsonQuery<Record<string, unknown>>(client, { ...common, query: `WITH ${cte.sql} SELECT toUnixTimestamp(${bucket}) bucket_ts, sum(request_count) request_count, sum(input_tokens) input_tokens, sum(output_tokens) output_tokens, sum(input_tokens+output_tokens) total_tokens, sum(cache_tokens) cache_tokens FROM dedup GROUP BY bucket_ts ORDER BY bucket_ts` });
    const [summaryRows, rankingRows, stabilityRows, trendRows] = await Promise.all([summaryPromise, rankingsPromise, stabilityPromise, trendPromise]);
    const s = summaryRows[0] ?? {};
    const summary: SummaryMetrics = { requestCount:num(s.request_count), inputTokens:num(s.input_tokens), outputTokens:num(s.output_tokens), totalTokens:num(s.total_tokens), cacheTokens:num(s.cache_tokens), avgOutputTokensPerSec:nullableDivide(s.speed_sum,s.speed_count), activeUserCount:num(s.active_users), activeChannelCount:num(s.active_channels) };
    const stabilitySummary: StabilitySummary = { totalAttempts:num(s.attempts), successCount:num(s.successes), errorCount:num(s.errors), errorRate:num(s.attempts)>0?num(s.errors)/num(s.attempts):null, avgFirstTokenLatency:nullableDivide(s.frt_sum,s.frt_count), avgTotalResponseTime:nullableDivide(s.response_sum,s.response_count) };
    const rank = (kind:string)=>rankingRows.filter(r=>r.kind===kind);
    const tokenRankings: TokenRankingRow[] = rank("token").map(r=>({ tokenId:num(r.id),tokenName:String(r.name??""),username:String(r.secondary??""),displayName:"",status:-1,expiredTime:0,requestCount:num(r.requests),inputTokens:num(r.input),outputTokens:num(r.output),totalTokens:num(r.total),cacheTokens:num(r.cache),outputTokensPerSec:nullableDivide(r.speed_sum,r.speed_count),latestUsedAt:num(r.latest) }));
    const userRankings: UserRankingRow[] = rank("user").map(r=>({ userId:num(r.id),username:String(r.name??""),displayName:"",status:-1,requestCount:num(r.requests),inputTokens:num(r.input),outputTokens:num(r.output),totalTokens:num(r.total),cacheTokens:num(r.cache),outputTokensPerSec:nullableDivide(r.speed_sum,r.speed_count),latestUsedAt:num(r.latest) }));
    const modelRankings: ModelRankingRow[] = rank("model").map(r=>({ modelName:String(r.name??""),requestCount:num(r.requests),inputTokens:num(r.input),outputTokens:num(r.output),totalTokens:num(r.total),cacheTokens:num(r.cache),outputTokensPerSec:nullableDivide(r.speed_sum,r.speed_count),latestUsedAt:num(r.latest) }));
    const channelRankings: ChannelRankingRow[] = rank("channel").map(r=>({ channelId:num(r.id),channelName:String(r.name??""),type:-1,status:-1,requestCount:num(r.requests),inputTokens:num(r.input),outputTokens:num(r.output),totalTokens:num(r.total),cacheTokens:num(r.cache),outputTokensPerSec:nullableDivide(r.speed_sum,r.speed_count),latestUsedAt:num(r.latest) }));
    const stable = (kind:string)=>stabilityRows.filter(r=>r.kind===kind);
    const mapStable=(r:Record<string,unknown>)=>({ totalAttempts:num(r.attempts),successCount:num(r.successes),errorCount:num(r.errors),errorRate:num(r.attempts)>0?num(r.errors)/num(r.attempts):0,avgFirstTokenLatency:nullableDivide(r.frt_sum,r.frt_count),avgTotalResponseTime:nullableDivide(r.response_sum,r.response_count),avgOutputTokensPerSec:nullableDivide(r.speed_sum,r.speed_count),latestUsedAt:num(r.latest) });
    const modelStability: ModelStabilityRow[] = stable("model").map(r=>({modelName:String(r.name??""),...mapStable(r)}));
    const channelStability: ChannelStabilityRow[] = stable("channel").map(r=>({channelId:num(r.id),channelName:String(r.name??""),type:-1,status:-1,...mapStable(r)}));
    const trend: TrendPoint[] = trendRows.map(r=>({bucketTs:num(r.bucket_ts),requestCount:num(r.request_count),inputTokens:num(r.input_tokens),outputTokens:num(r.output_tokens),totalTokens:num(r.total_tokens),cacheTokens:num(r.cache_tokens)}));
    return {kind:"ready",data:{summary,stabilitySummary,tokenRankings,userRankings,modelRankings,channelRankings,modelStability,channelStability,trend,granularity:filters.granularity}};
  } catch (error) {
    console.error("[clickhouse-query] dashboard packet failed", error);
    return { kind: "error", safeMessage: SAFE_SYNCING };
  }
}

export async function getClickHouseTokenDetail(filters: DashboardFilters, tokenId:number, tokenName:string):Promise<TokenDetailData> {
  const cte=dedupCte({...filters,token:""});
  const params={...cte.params,tokenId,tokenName};
  const rows=await jsonQuery<Record<string,unknown>>(getClickHouseClient(),{query_params:params,query:`WITH ${cte.sql}, selected AS (SELECT * FROM dedup WHERE token_id={tokenId:UInt64} AND token_name={tokenName:String}), details AS (
    SELECT 'summary' kind, '' name, '0' id, min(first_used_at) first_used, uniqExact(model_name) models, uniqExactIf(channel_id,channel_id!=0) channels, 0 requests,0 input,0 output,0 total,0 cache,0 latest FROM selected
    UNION ALL SELECT * FROM (SELECT 'model' kind, model_name name, '0' id, 0 first_used,0 models,0 channels,sum(request_count) requests,sum(input_tokens) input,sum(output_tokens) output,sum(input_tokens+output_tokens) total,sum(cache_tokens) cache,max(latest_used_at) latest FROM selected GROUP BY model_name ORDER BY total DESC LIMIT 6)
    UNION ALL SELECT * FROM (SELECT 'channel' kind, if(max(channel_name)='',concat('渠道 ',toString(channel_id)),max(channel_name)) name,toString(channel_id) id,0 first_used,0 models,0 channels,sum(request_count) requests,sum(input_tokens) input,sum(output_tokens) output,sum(input_tokens+output_tokens) total,sum(cache_tokens) cache,max(latest_used_at) latest FROM selected WHERE channel_id!=0 GROUP BY channel_id ORDER BY total DESC LIMIT 6)
  ) SELECT * FROM details`});
  const s=rows.find(r=>r.kind==="summary")??{};
  return {firstUsedAt:num(s.first_used),activeModelCount:num(s.models),activeChannelCount:num(s.channels),models:rows.filter(r=>r.kind==="model").map(r=>({modelName:String(r.name),requestCount:num(r.requests),inputTokens:num(r.input),outputTokens:num(r.output),totalTokens:num(r.total),cacheTokens:num(r.cache),latestUsedAt:num(r.latest)})),channels:rows.filter(r=>r.kind==="channel").map(r=>({channelId:num(r.id),channelName:String(r.name),requestCount:num(r.requests),inputTokens:num(r.input),outputTokens:num(r.output),totalTokens:num(r.total),cacheTokens:num(r.cache),latestUsedAt:num(r.latest)}))};
}
