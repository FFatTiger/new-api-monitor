import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";

import type { DbClient, TransactionOptions } from "../db.ts";
import type { DashboardFilters } from "../queries/dashboard.ts";
import { DASHBOARD_ROLLUP_GRAINS, type DashboardRollupConfig } from "./rollup-config.ts";
import {
  decomposeDashboardRange,
  getClosedDashboardWatermark,
  getDashboardThirtyDayRange,
} from "./rollup-time.ts";
import type { DashboardRollupReadiness } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, "rollup-query.ts");
const RAW_LOGS_RE = /\b(FROM|JOIN)\s+logs\b/i;

const enabledConfig: DashboardRollupConfig = {
  workerEnabled: true,
  readsEnabled: true,
  batchSize: 100,
  pauseMs: 500,
  statementTimeoutMs: 4321,
};

const disabledConfig: DashboardRollupConfig = {
  ...enabledConfig,
  readsEnabled: false,
};

function filters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    preset: "30d",
    token: "",
    username: "",
    model: "",
    channelId: "",
    startInput: "",
    endInput: "",
    startTimestamp: 1,
    endTimestamp: 2,
    granularity: "day",
    windowLabel: "近 30 天",
    ...overrides,
  };
}

function readyReadiness(
  partial: Partial<Extract<DashboardRollupReadiness, { kind: "ready" }>> = {},
): Extract<DashboardRollupReadiness, { kind: "ready" }> {
  return {
    kind: "ready",
    version: 1,
    processedRows: 1_240_000,
    processedMinCreatedAt: 1_700_000_000,
    processedMaxCreatedAt: 1_710_000_000,
    ...partial,
  };
}

type QueryCall = { text: string; values: unknown[] };

function createFakeClient(
  handler: (text: string, values: unknown[], callIndex: number) => { rows: Record<string, unknown>[] },
): { client: DbClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let callIndex = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      const entry = { text, values: values ?? [] };
      calls.push(entry);
      return handler(text, values ?? [], callIndex++);
    },
  } as DbClient;
  return { client, calls };
}

describe("dashboard rollup query module contract", () => {
  it("fails to import until implementation exists (or exports the public surface)", async () => {
    const mod = await import("./rollup-query.ts");
    for (const name of [
      "getDashboardRollupReadiness",
      "readDashboardRollupReadiness",
      "createDashboardRollupPlan",
      "getDashboardFilterMask",
      "getDashboardRequiredMasks",
      "buildDashboardRollupPacketQueries",
      "executeDashboardRollupPacket",
      "getDashboardRollupPacket",
      "getDashboardRollupModelOptions",
      "buildDashboardRollupTokenDetailQueries",
      "executeDashboardRollupTokenDetail",
      "getDashboardRollupTokenDetail",
    ]) {
      assert.equal(typeof (mod as Record<string, unknown>)[name], "function", name);
    }
  });
});

describe("dashboard rollup readiness", () => {
  beforeEach(async () => {
    const { __resetRollupQueryTestHooks } = await import("./rollup-query.ts");
    __resetRollupQueryTestHooks?.();
  });

  afterEach(async () => {
    const { __resetRollupQueryTestHooks } = await import("./rollup-query.ts");
    __resetRollupQueryTestHooks?.();
  });

  it("returns disabled without transaction or DB when readsEnabled is false", async () => {
    const { getDashboardRollupReadiness, __setWithTransactionForTests } = await import(
      "./rollup-query.ts"
    );
    let called = false;
    __setWithTransactionForTests(async () => {
      called = true;
      throw new Error("should not open transaction");
    });
    const result = await getDashboardRollupReadiness(disabledConfig);
    assert.equal(called, false);
    assert.deepEqual(result, {
      kind: "disabled",
      processedRows: 0,
      safeMessage: "长期统计尚未启用。",
    });
  });

  it("maps ready/building/unhealthy/initializing/inactive states without leaking last_error", async () => {
    const { readDashboardRollupReadiness } = await import("./rollup-query.ts");

    const readyClient = createFakeClient((text) => {
      if (/dashboard_rollup_registry/i.test(text)) {
        return { rows: [{ active_version: 1, building_version: null }] };
      }
      if (/dashboard_rollup_state/i.test(text)) {
        return {
          rows: [
            {
              version: 1,
              status: "active",
              history_complete: true,
              processed_rows: "1240000",
              processed_min_created_at: "100",
              processed_max_created_at: "200",
              last_error: "SECRET_DB_DETAIL",
            },
          ],
        };
      }
      throw new Error(`unexpected: ${text}`);
    });
    const ready = await readDashboardRollupReadiness(readyClient.client, enabledConfig);
    assert.deepEqual(ready, {
      kind: "ready",
      version: 1,
      processedRows: 1_240_000,
      processedMinCreatedAt: 100,
      processedMaxCreatedAt: 200,
    });
    assert.equal(JSON.stringify(ready).includes("SECRET"), false);

    const buildingClient = createFakeClient((text) => {
      if (/dashboard_rollup_registry/i.test(text)) {
        return { rows: [{ active_version: null, building_version: 1 }] };
      }
      if (/dashboard_rollup_state/i.test(text)) {
        return {
          rows: [
            {
              version: 1,
              status: "building",
              history_complete: false,
              processed_rows: "42",
              processed_min_created_at: null,
              processed_max_created_at: null,
              last_error: "boom",
            },
          ],
        };
      }
      throw new Error(`unexpected: ${text}`);
    });
    const building = await readDashboardRollupReadiness(buildingClient.client, enabledConfig);
    assert.equal(building.kind, "building");
    if (building.kind === "building") {
      assert.equal(building.processedRows, 42);
      assert.match(building.safeMessage, /构建|处理/);
      assert.equal(building.safeMessage.includes("boom"), false);
    }

    const unhealthyClient = createFakeClient((text) => {
      if (/dashboard_rollup_registry/i.test(text)) {
        return { rows: [{ active_version: 1, building_version: null }] };
      }
      if (/dashboard_rollup_state/i.test(text)) {
        return {
          rows: [
            {
              version: 1,
              status: "unhealthy",
              history_complete: true,
              processed_rows: "9",
              processed_min_created_at: "1",
              processed_max_created_at: "2",
              last_error: "INTERNAL_STACK",
            },
          ],
        };
      }
      throw new Error(`unexpected: ${text}`);
    });
    const unhealthy = await readDashboardRollupReadiness(unhealthyClient.client, enabledConfig);
    assert.equal(unhealthy.kind, "unhealthy");
    if (unhealthy.kind === "unhealthy") {
      assert.equal(unhealthy.safeMessage.includes("INTERNAL_STACK"), false);
      assert.equal(unhealthy.processedRows, 9);
    }

    const inactiveClient = createFakeClient((text) => {
      if (/dashboard_rollup_registry/i.test(text)) {
        return { rows: [{ active_version: 1, building_version: null }] };
      }
      if (/dashboard_rollup_state/i.test(text)) {
        return {
          rows: [
            {
              version: 1,
              status: "inactive",
              history_complete: true,
              processed_rows: "3",
              processed_min_created_at: "1",
              processed_max_created_at: "2",
              last_error: null,
            },
          ],
        };
      }
      throw new Error(`unexpected: ${text}`);
    });
    const inactive = await readDashboardRollupReadiness(inactiveClient.client, enabledConfig);
    assert.notEqual(inactive.kind, "ready");

    const missingClient = createFakeClient(() => ({ rows: [] }));
    const initializing = await readDashboardRollupReadiness(missingClient.client, enabledConfig);
    assert.equal(initializing.kind, "initializing");
  });

  it("public readiness catches undefined-table 42P01 as initializing and other failures as unhealthy", async () => {
    const { getDashboardRollupReadiness, __setWithTransactionForTests } = await import(
      "./rollup-query.ts"
    );

    __setWithTransactionForTests(async () => {
      const err = Object.assign(new Error("relation missing"), { code: "42P01" });
      throw err;
    });
    const missing = await getDashboardRollupReadiness(enabledConfig);
    assert.equal(missing.kind, "initializing");

    __setWithTransactionForTests(async () => {
      throw Object.assign(new Error("disk full"), { code: "53100" });
    });
    const failed = await getDashboardRollupReadiness(enabledConfig);
    assert.equal(failed.kind, "unhealthy");
    if (failed.kind === "unhealthy") {
      assert.equal(failed.safeMessage.includes("disk full"), false);
    }
  });
});

describe("dashboard rollup masks and plan", () => {
  it("computes filter mask and required masks exactly", async () => {
    const { getDashboardFilterMask, getDashboardRequiredMasks } = await import("./rollup-query.ts");
    assert.equal(getDashboardFilterMask(filters()), 0);
    assert.deepEqual(getDashboardRequiredMasks(filters()), [0, 1, 2, 4, 8]);
    assert.equal(getDashboardFilterMask(filters({ token: "abc" })), 15);
    assert.equal(getDashboardFilterMask(filters({ username: "u" })), 15);
    assert.equal(getDashboardFilterMask(filters({ model: "m" })), 15);
    assert.equal(getDashboardFilterMask(filters({ channelId: "9" })), 15);
    assert.deepEqual(getDashboardRequiredMasks(filters({ token: "x" })), [15]);
  });

  it("builds 30d plan from watermark decomposition and empty all plan", async () => {
    const { createDashboardRollupPlan } = await import("./rollup-query.ts");
    const nowSeconds = Date.UTC(2024, 5, 15, 12, 34, 45) / 1000;
    const maxProcessed = Date.UTC(2024, 5, 15, 12, 33, 20) / 1000;
    const watermark = getClosedDashboardWatermark(maxProcessed, nowSeconds);
    assert.ok(watermark !== null);
    assert.equal(watermark % 60, 0);

    const readiness = readyReadiness({ processedMaxCreatedAt: maxProcessed });
    const plan30 = createDashboardRollupPlan(readiness, filters({ preset: "30d" }), nowSeconds);
    const expectedRange = getDashboardThirtyDayRange(watermark);
    const expectedSegments = decomposeDashboardRange(expectedRange.start, expectedRange.end);

    assert.equal(plan30.kind, "rollup");
    assert.equal(plan30.preset, "30d");
    assert.equal(plan30.version, 1);
    assert.equal(plan30.startTimestamp, expectedRange.start);
    assert.equal(plan30.endTimestamp, expectedRange.end);
    assert.deepEqual(plan30.segments, expectedSegments);
    assert.ok(plan30.segments.length >= 1);
    assert.equal(plan30.segments[0]!.start, expectedRange.start);
    assert.equal(plan30.segments[plan30.segments.length - 1]!.end, expectedRange.end);

    const planAll = createDashboardRollupPlan(
      readiness,
      filters({ preset: "all", startTimestamp: null, endTimestamp: null }),
      nowSeconds,
    );
    assert.equal(planAll.preset, "all");
    assert.equal(planAll.startTimestamp, null);
    assert.equal(planAll.endTimestamp, null);
    assert.deepEqual(planAll.segments, []);
  });

  it("throws when 30d watermark is null or invalid", async () => {
    const { createDashboardRollupPlan } = await import("./rollup-query.ts");
    assert.throws(
      () =>
        createDashboardRollupPlan(
          readyReadiness({ processedMaxCreatedAt: null }),
          filters({ preset: "30d" }),
          1_700_000_000,
        ),
      /watermark|processed/i,
    );
  });
});

describe("dashboard rollup SQL builders", () => {
  it("never references raw logs in module source or built queries", async () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    assert.doesNotMatch(source, RAW_LOGS_RE);

    const {
      buildDashboardRollupPacketQueries,
      buildDashboardRollupTokenDetailQueries,
      createDashboardRollupPlan,
    } = await import("./rollup-query.ts");

    const readiness = readyReadiness({
      processedMaxCreatedAt: Date.UTC(2024, 5, 15, 12, 33, 20) / 1000,
    });
    const nowSeconds = Date.UTC(2024, 5, 15, 12, 34, 45) / 1000;
    const plan30 = createDashboardRollupPlan(readiness, filters({ preset: "30d" }), nowSeconds);
    const planAll = createDashboardRollupPlan(
      readiness,
      filters({ preset: "all", startTimestamp: null, endTimestamp: null }),
      nowSeconds,
    );

    const queries = [
      ...buildDashboardRollupPacketQueries(plan30),
      ...buildDashboardRollupPacketQueries(planAll),
      ...buildDashboardRollupTokenDetailQueries(plan30, { tokenId: 1, tokenName: "k" }),
      ...buildDashboardRollupTokenDetailQueries(planAll, { tokenId: 0, tokenName: "Unknown" }),
    ];

    assert.ok(queries.length >= 7);
    for (const q of queries) {
      assert.doesNotMatch(q.text, RAW_LOGS_RE);
      assert.match(q.text, /dashboard_rollups|dashboard_rollup_dimensions/);
      // no string-interpolated filter text
      assert.equal(q.text.includes("%abc%"), false);
    }
  });

  it("returns exactly four packet queries and three token-detail queries", async () => {
    const {
      buildDashboardRollupPacketQueries,
      buildDashboardRollupTokenDetailQueries,
      createDashboardRollupPlan,
    } = await import("./rollup-query.ts");
    const plan = createDashboardRollupPlan(
      readyReadiness({ processedMaxCreatedAt: Date.UTC(2024, 5, 15, 12, 0, 0) / 1000 }),
      filters({ preset: "30d" }),
      Date.UTC(2024, 5, 15, 12, 1, 0) / 1000,
    );
    const packet = buildDashboardRollupPacketQueries(plan);
    assert.deepEqual(
      packet.map((q) => q.name),
      ["summary", "rankings", "stability", "trend"],
    );
    const detail = buildDashboardRollupTokenDetailQueries(plan, { tokenId: 7, tokenName: "t" });
    assert.deepEqual(
      detail.map((q) => q.name),
      ["summary", "models", "channels"],
    );
  });

  it("30d VALUES segments are nonoverlapping exact grain/start/end binds", async () => {
    const { buildDashboardRollupPacketQueries, createDashboardRollupPlan } = await import(
      "./rollup-query.ts"
    );
    const nowSeconds = Date.UTC(2024, 5, 15, 12, 34, 45) / 1000;
    const maxProcessed = Date.UTC(2024, 5, 15, 12, 33, 20) / 1000;
    const plan = createDashboardRollupPlan(
      readyReadiness({ processedMaxCreatedAt: maxProcessed }),
      filters({ preset: "30d" }),
      nowSeconds,
    );
    const packet = buildDashboardRollupPacketQueries(plan);
    for (const q of packet) {
      assert.match(q.text, /segments\s*\(\s*grain\s*,\s*start_ts\s*,\s*end_ts\s*\)/i);
      assert.match(
        q.text,
        /r\.grain\s*=\s*s\.grain[\s\S]*r\.bucket_start\s*>=\s*s\.start_ts[\s\S]*r\.bucket_start\s*<\s*s\.end_ts/i,
      );
    }
    // every segment triple appears as bound values in summary
    const summary = packet.find((q) => q.name === "summary")!;
    for (const segment of plan.segments) {
      assert.ok(summary.values.includes(segment.grain));
      assert.ok(summary.values.includes(segment.start));
      assert.ok(summary.values.includes(segment.end));
    }
    // nonoverlapping: end of each equals start of next when sorted
    const ordered = [...plan.segments].sort((a, b) => a.start - b.start);
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.equal(ordered[i]!.end, ordered[i + 1]!.start);
    }
  });

  it("unfiltered packet uses sparse masks 0/1/2/4/8 and filtered uses mask 15 with bound filters", async () => {
    const { buildDashboardRollupPacketQueries, createDashboardRollupPlan } = await import(
      "./rollup-query.ts"
    );
    const readiness = readyReadiness({
      processedMaxCreatedAt: Date.UTC(2024, 5, 15, 12, 0, 0) / 1000,
    });
    const nowSeconds = Date.UTC(2024, 5, 15, 12, 1, 0) / 1000;

    const unfiltered = buildDashboardRollupPacketQueries(
      createDashboardRollupPlan(readiness, filters({ preset: "30d" }), nowSeconds),
    );
    const summaryText = unfiltered.find((q) => q.name === "summary")!.text;
    const rankingsText = unfiltered.find((q) => q.name === "rankings")!.text;
    // summary mask0, users mask2, channels mask8
    assert.match(summaryText, /dimension_mask\s*=\s*\$?\d*|dimension_mask\s+IN|mask/i);
    assert.ok(
      unfiltered.some((q) => q.values.includes(0)) || /dimension_mask\s*=\s*0/.test(summaryText),
    );
    assert.ok(
      unfiltered.some((q) => q.values.includes(2)) || /dimension_mask\s*=\s*2/.test(summaryText),
    );
    assert.ok(
      unfiltered.some((q) => q.values.includes(8)) || /dimension_mask\s*=\s*8/.test(summaryText),
    );
    for (const mask of [1, 2, 4, 8]) {
      assert.ok(
        rankingsText.includes(String(mask)) ||
          unfiltered.find((q) => q.name === "rankings")!.values.includes(mask),
        `rankings should use mask ${mask}`,
      );
    }

    const filteredPlan = createDashboardRollupPlan(
      readiness,
      filters({
        preset: "30d",
        token: "abc",
        username: "alice",
        model: "gpt-4",
        channelId: "12",
      }),
      nowSeconds,
    );
    const filtered = buildDashboardRollupPacketQueries(filteredPlan);
    for (const q of filtered) {
      assert.ok(q.values.includes(15) || /dimension_mask\s*=\s*15/.test(q.text));
      assert.ok(q.values.includes("%abc%"), "token pattern must be bound");
      assert.ok(q.values.includes("alice"));
      assert.ok(q.values.includes("gpt-4"));
      assert.ok(q.values.includes("12") || q.values.includes(12));
      assert.equal(q.text.includes("%abc%"), false);
      assert.equal(q.text.includes("alice"), false);
      assert.equal(q.text.includes("gpt-4"), false);
    }
  });

  it("unfiltered all summary is mask0/all-time grain4; all trend uses day grain not all grain", async () => {
    const { buildDashboardRollupPacketQueries, createDashboardRollupPlan } = await import(
      "./rollup-query.ts"
    );
    const plan = createDashboardRollupPlan(
      readyReadiness(),
      filters({ preset: "all", startTimestamp: null, endTimestamp: null }),
    );
    const queries = buildDashboardRollupPacketQueries(plan);
    const summary = queries.find((q) => q.name === "summary")!;
    const trend = queries.find((q) => q.name === "trend")!;
    assert.ok(
      summary.values.includes(DASHBOARD_ROLLUP_GRAINS.all) || /grain\s*=\s*4/.test(summary.text),
    );
    assert.ok(summary.values.includes(0) || /dimension_mask\s*=\s*0/.test(summary.text));
    assert.match(summary.text, /bucket_start\s*=\s*0|bucket_start\s*=\s*\$/i);

    assert.ok(
      trend.values.includes(DASHBOARD_ROLLUP_GRAINS.day) || /grain\s*=\s*3/.test(trend.text),
    );
    assert.equal(
      trend.values.includes(DASHBOARD_ROLLUP_GRAINS.all) && /grain\s*=\s*4/.test(trend.text),
      false,
    );
    // trend should not force grain=4 path for all-time
    assert.doesNotMatch(trend.text, /grain\s*=\s*4/);
  });
});

describe("dashboard rollup packet mapping", () => {
  it("maps summary/stability averages and null denominators safely", async () => {
    const { executeDashboardRollupPacket, createDashboardRollupPlan } = await import(
      "./rollup-query.ts"
    );
    const plan = createDashboardRollupPlan(
      readyReadiness(),
      filters({ preset: "all", startTimestamp: null, endTimestamp: null }),
    );
    const { client } = createFakeClient((text) => {
      if (/dimension_kind/i.test(text) || /token_rank|AS\s+'token'|AS\s+"token"/i.test(text)) {
        return { rows: [] };
      }
      if (/bucket_ts/i.test(text)) {
        return { rows: [] };
      }
      // summary (+ stability fields)
      return {
        rows: [
          {
            request_count: "10",
            input_tokens: "100",
            output_tokens: "50",
            cache_tokens: "5",
            output_tokens_per_sec_sum: "20",
            output_tokens_per_sec_count: "0",
            active_user_count: "3",
            active_channel_count: "2",
            total_attempts: "0",
            success_count: "0",
            error_count: "0",
            first_token_latency_sum: "10",
            first_token_latency_count: "0",
            response_time_sum: "0",
            response_time_count: "0",
          },
        ],
      };
    });

    const packet = await executeDashboardRollupPacket(client, plan);
    assert.equal(packet.summary.requestCount, 10);
    assert.equal(packet.summary.inputTokens, 100);
    assert.equal(packet.summary.outputTokens, 50);
    assert.equal(packet.summary.totalTokens, 150);
    assert.equal(packet.summary.cacheTokens, 5);
    assert.equal(packet.summary.avgOutputTokensPerSec, null);
    assert.equal(packet.summary.activeUserCount, 3);
    assert.equal(packet.summary.activeChannelCount, 2);
    assert.equal(packet.stabilitySummary.totalAttempts, 0);
    assert.equal(packet.stabilitySummary.errorRate, null);
    assert.equal(packet.stabilitySummary.avgFirstTokenLatency, null);
    assert.equal(packet.stabilitySummary.avgTotalResponseTime, null);
    assert.equal(packet.granularity, "day");
  });

  it("maps rankings with join fallbacks and stability rows", async () => {
    const { executeDashboardRollupPacket, createDashboardRollupPlan } = await import(
      "./rollup-query.ts"
    );
    const plan = createDashboardRollupPlan(
      readyReadiness(),
      filters({ preset: "all", startTimestamp: null, endTimestamp: null }),
    );

    const { client } = createFakeClient((_text, _values, callIndex) => {
      // Packet order: summary, rankings, stability, trend
      if (callIndex === 0) {
        return {
          rows: [
            {
              request_count: "1",
              input_tokens: "1",
              output_tokens: "1",
              cache_tokens: "0",
              output_tokens_per_sec_sum: "1",
              output_tokens_per_sec_count: "1",
              active_user_count: "1",
              active_channel_count: "1",
              total_attempts: "2",
              success_count: "1",
              error_count: "1",
              first_token_latency_sum: "4",
              first_token_latency_count: "2",
              response_time_sum: "6",
              response_time_count: "2",
            },
          ],
        };
      }
      if (callIndex === 1) {
        return {
          rows: [
            {
              dimension_kind: "token",
              token_id: "1",
              token_name: "tok",
              username: "alice",
              display_name: "Alice",
              status: "1",
              expired_time: "-1",
              request_count: "2",
              input_tokens: "10",
              output_tokens: "4",
              total_tokens: "14",
              cache_tokens: "1",
              output_tokens_per_sec: null,
              latest_used_at: "100",
            },
            {
              dimension_kind: "user",
              user_id: "9",
              username: "bob",
              display_name: "",
              status: "-1",
              request_count: "3",
              input_tokens: "1",
              output_tokens: "1",
              total_tokens: "2",
              cache_tokens: "0",
              output_tokens_per_sec: null,
              latest_used_at: "101",
            },
            {
              dimension_kind: "model",
              model_name: "gpt",
              request_count: "4",
              input_tokens: "8",
              output_tokens: "8",
              total_tokens: "16",
              cache_tokens: "0",
              output_tokens_per_sec: "1.5",
              latest_used_at: "102",
            },
            {
              dimension_kind: "channel",
              channel_id: "0",
              channel_name: "渠道 0",
              type: "-1",
              status: "-1",
              request_count: "1",
              input_tokens: "1",
              output_tokens: "1",
              total_tokens: "2",
              cache_tokens: "0",
              output_tokens_per_sec: null,
              latest_used_at: "103",
            },
          ],
        };
      }
      if (callIndex === 2) {
        return {
          rows: [
            {
              dimension_kind: "model",
              model_name: "gpt",
              total_attempts: "10",
              success_count: "8",
              error_count: "2",
              error_rate: "0.2",
              avg_first_token_latency: "1.5",
              avg_total_response_time: "2.5",
              avg_output_tokens_per_sec: "3.5",
              latest_used_at: "200",
            },
            {
              dimension_kind: "channel",
              channel_id: "5",
              channel_name: "ch-5",
              type: "1",
              status: "1",
              total_attempts: "4",
              success_count: "1",
              error_count: "3",
              error_rate: "0.75",
              avg_first_token_latency: null,
              avg_total_response_time: "9",
              avg_output_tokens_per_sec: null,
              latest_used_at: "201",
            },
          ],
        };
      }
      return {
        rows: [
          {
            bucket_ts: "1000",
            request_count: "2",
            input_tokens: "5",
            output_tokens: "7",
            cache_tokens: "1",
          },
          {
            bucket_ts: "2000",
            request_count: "1",
            input_tokens: "3",
            output_tokens: "4",
            cache_tokens: "0",
          },
        ],
      };
    });

    const packet = await executeDashboardRollupPacket(client, plan);
    assert.equal(packet.tokenRankings.length, 1);
    assert.equal(packet.tokenRankings[0]!.tokenId, 1);
    assert.equal(packet.tokenRankings[0]!.tokenName, "tok");
    assert.equal(packet.tokenRankings[0]!.outputTokensPerSec, null);
    assert.equal(packet.userRankings[0]!.userId, 9);
    assert.equal(packet.userRankings[0]!.outputTokensPerSec, null);
    assert.equal(packet.modelRankings[0]!.modelName, "gpt");
    assert.equal(packet.modelRankings[0]!.outputTokensPerSec, 1.5);
    assert.equal(packet.channelRankings[0]!.channelName, "渠道 0");
    assert.equal(packet.modelStability[0]!.errorRate, 0.2);
    assert.equal(packet.channelStability[0]!.channelId, 5);
    assert.equal(packet.trend.length, 2);
    assert.equal(packet.trend[0]!.bucketTs, 1000);
    assert.equal(packet.trend[0]!.totalTokens, 12);
    assert.equal(packet.trend[1]!.totalTokens, 7);
    assert.ok(packet.trend[0]!.bucketTs < packet.trend[1]!.bucketTs);
    assert.equal(packet.stabilitySummary.errorRate, 0.5);
    assert.equal(packet.stabilitySummary.avgFirstTokenLatency, 2);
    assert.equal(packet.stabilitySummary.avgTotalResponseTime, 3);
    assert.equal(packet.summary.avgOutputTokensPerSec, 1);
  });
});

describe("dashboard rollup public wrappers", () => {
  beforeEach(async () => {
    const { __resetRollupQueryTestHooks } = await import("./rollup-query.ts");
    __resetRollupQueryTestHooks?.();
  });
  afterEach(async () => {
    const { __resetRollupQueryTestHooks } = await import("./rollup-query.ts");
    __resetRollupQueryTestHooks?.();
  });

  it("public packet uses one repeatable-read readonly transaction and returns safe error union", async () => {
    const {
      getDashboardRollupPacket,
      createDashboardRollupPlan,
      __setWithTransactionForTests,
    } = await import("./rollup-query.ts");
    const plan = createDashboardRollupPlan(
      readyReadiness(),
      filters({ preset: "all", startTimestamp: null, endTimestamp: null }),
    );

    let txCalls = 0;
    let seenOptions: TransactionOptions | undefined;
    __setWithTransactionForTests(async (callback, options) => {
      txCalls += 1;
      seenOptions = options;
      const { client } = createFakeClient(() => ({
        rows: [
          {
            request_count: "0",
            input_tokens: "0",
            output_tokens: "0",
            cache_tokens: "0",
            output_tokens_per_sec_sum: "0",
            output_tokens_per_sec_count: "0",
            active_user_count: "0",
            active_channel_count: "0",
            total_attempts: "0",
            success_count: "0",
            error_count: "0",
            first_token_latency_sum: "0",
            first_token_latency_count: "0",
            response_time_sum: "0",
            response_time_count: "0",
          },
        ],
      }));
      return callback(client);
    });

    const ok = await getDashboardRollupPacket(plan, enabledConfig);
    assert.equal(txCalls, 1);
    assert.deepEqual(seenOptions, {
      statementTimeoutMs: 4321,
      disableParallelGather: true,
      isolationLevel: "repeatable read",
      readOnly: true,
    });
    assert.equal(ok.kind, "ready");

    __setWithTransactionForTests(async () => {
      throw new Error("SQL exploded with secret values");
    });
    const failed = await getDashboardRollupPacket(plan, enabledConfig);
    assert.deepEqual(failed, {
      kind: "error",
      safeMessage: "长期统计读取失败，请稍后重试。",
    });
  });

  it("model options query dimensions only, excludes Unknown, returns empty on error", async () => {
    const {
      getDashboardRollupModelOptions,
      __setWithTransactionForTests,
      buildDashboardRollupModelOptionsQuery,
    } = await import("./rollup-query.ts");

    assert.equal(typeof buildDashboardRollupModelOptionsQuery, "function");
    const q = buildDashboardRollupModelOptionsQuery(1);
    assert.doesNotMatch(q.text, RAW_LOGS_RE);
    assert.match(q.text, /dashboard_rollup_dimensions/);
    assert.match(q.text, /<>\s*'Unknown'/);
    assert.ok(q.values.includes(1));
    assert.match(q.text, /dimension_mask\s+IN\s*\(\s*4\s*,\s*15\s*\)/);

    let seenSql = "";
    __setWithTransactionForTests(async (callback) => {
      const { client, calls } = createFakeClient(() => ({
        rows: [
          { value: "alpha", label: "alpha" },
          { value: "beta", label: "beta" },
        ],
      }));
      const result = await callback(client);
      seenSql = calls[0]?.text ?? "";
      return result;
    });
    const options = await getDashboardRollupModelOptions(1, enabledConfig);
    assert.deepEqual(options, [
      { value: "alpha", label: "alpha" },
      { value: "beta", label: "beta" },
    ]);
    assert.doesNotMatch(seenSql, RAW_LOGS_RE);
    assert.match(seenSql, /dashboard_rollup_dimensions/);
    assert.match(seenSql, /<>\s*'Unknown'/);

    __setWithTransactionForTests(async () => {
      throw new Error("fail");
    });
    const empty = await getDashboardRollupModelOptions(1, enabledConfig);
    assert.deepEqual(empty, []);
  });

  it("token detail builders match token id/name rules and public wrapper is safe", async () => {
    const {
      buildDashboardRollupTokenDetailQueries,
      executeDashboardRollupTokenDetail,
      getDashboardRollupTokenDetail,
      createDashboardRollupPlan,
      __setWithTransactionForTests,
    } = await import("./rollup-query.ts");

    const plan = createDashboardRollupPlan(
      readyReadiness(),
      filters({ preset: "all", startTimestamp: null, endTimestamp: null, token: "ab" }),
    );
    const idQueries = buildDashboardRollupTokenDetailQueries(plan, {
      tokenId: 7,
      tokenName: "t7",
    });
    for (const q of idQueries) {
      assert.doesNotMatch(q.text, RAW_LOGS_RE);
      assert.ok(q.values.includes(15) || /dimension_mask\s*=\s*15/.test(q.text));
      assert.ok(q.values.includes(7));
    }
    const zeroQueries = buildDashboardRollupTokenDetailQueries(plan, {
      tokenId: 0,
      tokenName: "Unknown",
    });
    for (const q of zeroQueries) {
      assert.ok(q.values.includes(0));
      assert.ok(q.values.includes("Unknown"));
    }

    const { client } = createFakeClient((text) => {
      if (/model_name/i.test(text) && /request_count/i.test(text) && !/channel/i.test(text)) {
        return {
          rows: [
            {
              model_name: "gpt",
              request_count: "2",
              input_tokens: "3",
              output_tokens: "4",
              total_tokens: "7",
              cache_tokens: "1",
              latest_used_at: "9",
            },
          ],
        };
      }
      if (/channel_id/i.test(text) && /channel_name/i.test(text)) {
        return {
          rows: [
            {
              channel_id: "3",
              channel_name: "ch",
              request_count: "1",
              input_tokens: "1",
              output_tokens: "2",
              total_tokens: "3",
              cache_tokens: "0",
              latest_used_at: "8",
            },
          ],
        };
      }
      return {
        rows: [
          {
            first_used_at: "5",
            active_model_count: "1",
            active_channel_count: "1",
          },
        ],
      };
    });
    const detail = await executeDashboardRollupTokenDetail(client, plan, {
      tokenId: 7,
      tokenName: "t7",
    });
    assert.equal(detail.firstUsedAt, 5);
    assert.equal(detail.activeModelCount, 1);
    assert.equal(detail.models[0]!.modelName, "gpt");
    assert.equal(detail.channels[0]!.channelId, 3);

    let txCalls = 0;
    __setWithTransactionForTests(async (callback, options) => {
      txCalls += 1;
      assert.equal(options?.isolationLevel, "repeatable read");
      assert.equal(options?.readOnly, true);
      assert.equal(options?.disableParallelGather, true);
      assert.equal(options?.statementTimeoutMs, enabledConfig.statementTimeoutMs);
      return callback(client);
    });
    const ok = await getDashboardRollupTokenDetail(plan, { tokenId: 7, tokenName: "t7" }, enabledConfig);
    assert.equal(txCalls, 1);
    assert.equal(ok.kind, "ready");

    __setWithTransactionForTests(async () => {
      throw new Error("nope");
    });
    const failed = await getDashboardRollupTokenDetail(
      plan,
      { tokenId: 7, tokenName: "t7" },
      enabledConfig,
    );
    assert.equal(failed.kind, "error");
    if (failed.kind === "error") {
      assert.equal(failed.safeMessage.includes("nope"), false);
    }
  });
});
