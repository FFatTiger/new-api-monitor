import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { DashboardFilters } from "../queries/dashboard.ts";
import type { DashboardRollupReadiness } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTING_SOURCE = join(__dirname, "dashboard-routing.ts");
const PAGE_SOURCE = join(__dirname, "../../app/page.tsx");
const DASHBOARD_QUERY_SOURCE = join(__dirname, "../queries/dashboard.ts");
const TOKEN_DETAIL_ROUTE_SOURCE = join(__dirname, "../../app/api/token-detail/route.ts");
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;

function baseFilters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    preset: "30d",
    token: "",
    username: "",
    model: "",
    channelId: "",
    startInput: "",
    endInput: "",
    startTimestamp: 1_700_000_000,
    endTimestamp: 1_700_000_000 + 8 * 86400,
    granularity: "day",
    windowLabel: "x",
    ...overrides,
  };
}

const ready: DashboardRollupReadiness = {
  kind: "ready",
  version: 1,
  processedRows: 10,
  processedMinCreatedAt: 1,
  processedMaxCreatedAt: 1_710_000_000,
};

const building: DashboardRollupReadiness = {
  kind: "building",
  processedRows: 10,
  safeMessage: "building",
};

const disabled: DashboardRollupReadiness = {
  kind: "disabled",
  processedRows: 0,
  safeMessage: "disabled",
};

const unhealthy: DashboardRollupReadiness = {
  kind: "unhealthy",
  processedRows: 3,
  safeMessage: "unhealthy",
};

const initializing: DashboardRollupReadiness = {
  kind: "initializing",
  processedRows: 0,
  safeMessage: "initializing",
};

describe("buildDashboardQueryPlan", () => {
  it("exports buildDashboardQueryPlan", async () => {
    const mod = await import("./dashboard-routing.ts");
    assert.equal(typeof mod.buildDashboardQueryPlan, "function");
  });

  it("keeps short presets on the legacy raw path", async () => {
    const { buildDashboardQueryPlan } = await import("./dashboard-routing.ts");
    for (const preset of ["today", "24h", "7d"] as const) {
      const plan = buildDashboardQueryPlan(baseFilters({ preset }), ready, true);
      assert.equal(plan.kind, "legacy");
    }
  });

  it("routes 30d and all to rollup only when ready and reads enabled together", async () => {
    const { buildDashboardQueryPlan } = await import("./dashboard-routing.ts");
    const rollup30 = buildDashboardQueryPlan(baseFilters({ preset: "30d" }), ready, true);
    assert.equal(rollup30.kind, "rollup");
    if (rollup30.kind === "rollup") {
      assert.equal(rollup30.preset, "30d");
      assert.equal(rollup30.version, 1);
      assert.ok(rollup30.segments.length > 0);
      assert.equal(typeof rollup30.startTimestamp, "number");
      assert.equal(typeof rollup30.endTimestamp, "number");
    }

    const rollupAll = buildDashboardQueryPlan(baseFilters({ preset: "all" }), ready, true);
    assert.equal(rollupAll.kind, "rollup");
    if (rollupAll.kind === "rollup") {
      assert.equal(rollupAll.preset, "all");
      assert.equal(rollupAll.startTimestamp, null);
      assert.equal(rollupAll.endTimestamp, null);
      assert.deepEqual(rollupAll.segments, []);
    }

    assert.equal(buildDashboardQueryPlan(baseFilters({ preset: "30d" }), ready, false).kind, "unavailable");
    assert.equal(buildDashboardQueryPlan(baseFilters({ preset: "all" }), building, true).kind, "unavailable");
    assert.equal(buildDashboardQueryPlan(baseFilters({ preset: "30d" }), building, true).kind, "unavailable");
    assert.equal(buildDashboardQueryPlan(baseFilters({ preset: "all" }), disabled, true).kind, "unavailable");
    assert.equal(buildDashboardQueryPlan(baseFilters({ preset: "30d" }), unhealthy, true).kind, "unavailable");
    assert.equal(buildDashboardQueryPlan(baseFilters({ preset: "all" }), initializing, true).kind, "unavailable");
  });

  it("blocks long custom ranges and invalid custom without raw fallback", async () => {
    const { buildDashboardQueryPlan } = await import("./dashboard-routing.ts");
    const longCustom = baseFilters({
      preset: "custom",
      startTimestamp: 1_700_000_000,
      endTimestamp: 1_700_000_000 + 8 * 86400,
    });
    const longPlan = buildDashboardQueryPlan(longCustom, ready, true);
    assert.equal(longPlan.kind, "unavailable");
    if (longPlan.kind === "unavailable") {
      assert.equal(longPlan.readiness.kind, "unsupported");
      assert.equal(longPlan.readiness.processedRows, 0);
      assert.match(longPlan.readiness.safeMessage, /7|自定义|不支持|长期/);
    }

    const shortCustom = baseFilters({
      preset: "custom",
      startTimestamp: 1_700_000_000,
      endTimestamp: 1_700_000_000 + 2 * 86400,
    });
    assert.equal(buildDashboardQueryPlan(shortCustom, ready, true).kind, "legacy");

    const exactSeven = baseFilters({
      preset: "custom",
      startTimestamp: 1_700_000_000,
      endTimestamp: 1_700_000_000 + SEVEN_DAYS,
    });
    assert.equal(buildDashboardQueryPlan(exactSeven, ready, true).kind, "legacy");

    const invalidCustom = baseFilters({
      preset: "custom",
      startTimestamp: null,
      endTimestamp: null,
    });
    const invalidPlan = buildDashboardQueryPlan(invalidCustom, ready, true);
    assert.equal(invalidPlan.kind, "unavailable");
    if (invalidPlan.kind === "unavailable") {
      assert.equal(invalidPlan.readiness.kind, "unsupported");
      assert.equal(invalidPlan.readiness.processedRows, 0);
    }
  });

  it("unavailable 30d/all carries readiness state for the status panel", async () => {
    const { buildDashboardQueryPlan } = await import("./dashboard-routing.ts");
    const plan = buildDashboardQueryPlan(baseFilters({ preset: "30d" }), building, true);
    assert.equal(plan.kind, "unavailable");
    if (plan.kind === "unavailable") {
      assert.equal(plan.readiness.kind, "building");
      assert.equal(plan.readiness.processedRows, 10);
      assert.equal(plan.readiness.safeMessage, "building");
      assert.equal(plan.filters.preset, "30d");
    }
  });
});

describe("parseDashboardRouteFilters", () => {
  it("parses 30d and all without source bounds", async () => {
    const { parseDashboardRouteFilters } = await import("./dashboard-routing.ts");
    const thirty = parseDashboardRouteFilters({ preset: "30d", token: " abc " });
    assert.equal(thirty.preset, "30d");
    assert.equal(thirty.token, "abc");
    assert.equal(thirty.windowLabel, "近 30 天");
    assert.equal(thirty.granularity, "day");

    const all = parseDashboardRouteFilters({ preset: "all" });
    assert.equal(all.preset, "all");
    assert.equal(all.startTimestamp, null);
    assert.equal(all.endTimestamp, null);
    assert.equal(all.windowLabel, "全部时间");
  });

  it("parses custom bounds from typed inputs only and rejects invalid custom", async () => {
    const { parseDashboardRouteFilters } = await import("./dashboard-routing.ts");
    const valid = parseDashboardRouteFilters({
      preset: "custom",
      start: "2024-01-01T00:00",
      end: "2024-01-02T23:59",
    });
    assert.equal(valid.preset, "custom");
    assert.equal(typeof valid.startTimestamp, "number");
    assert.equal(typeof valid.endTimestamp, "number");
    assert.ok((valid.endTimestamp ?? 0) > (valid.startTimestamp ?? 0));

    const invalid = parseDashboardRouteFilters({
      preset: "custom",
      start: "not-a-date",
      end: "",
    });
    assert.equal(invalid.preset, "custom");
    assert.equal(invalid.startTimestamp, null);
    assert.equal(invalid.endTimestamp, null);
  });

  it("parses short legacy presets with provided source bounds", async () => {
    const { parseDashboardRouteFilters } = await import("./dashboard-routing.ts");
    const maxTimestamp = 1_800_000_000;
    const minTimestamp = 1_700_000_000;
    const day = parseDashboardRouteFilters(
      { preset: "24h" },
      { minTimestamp, maxTimestamp },
    );
    assert.equal(day.preset, "24h");
    assert.equal(day.endTimestamp, maxTimestamp);
    assert.equal(day.startTimestamp, maxTimestamp - 24 * 60 * 60);
    assert.equal(day.windowLabel, "近 24 小时");
  });
});

describe("assertLegacyDashboardFilters", () => {
  it("throws for 30d, all, long custom, and invalid custom", async () => {
    const { assertLegacyDashboardFilters } = await import("./dashboard-routing.ts");
    assert.throws(() => assertLegacyDashboardFilters(baseFilters({ preset: "30d" })), /legacy|long-range|rollup/i);
    assert.throws(() => assertLegacyDashboardFilters(baseFilters({ preset: "all" })), /legacy|long-range|rollup/i);
    assert.throws(
      () =>
        assertLegacyDashboardFilters(
          baseFilters({
            preset: "custom",
            startTimestamp: 1,
            endTimestamp: 1 + 8 * 86400,
          }),
        ),
      /legacy|long-range|unsupported|custom/i,
    );
    assert.throws(
      () =>
        assertLegacyDashboardFilters(
          baseFilters({
            preset: "custom",
            startTimestamp: null,
            endTimestamp: null,
          }),
        ),
      /legacy|long-range|unsupported|custom/i,
    );
  });

  it("allows short presets and short custom", async () => {
    const { assertLegacyDashboardFilters } = await import("./dashboard-routing.ts");
    assert.doesNotThrow(() => assertLegacyDashboardFilters(baseFilters({ preset: "today" })));
    assert.doesNotThrow(() => assertLegacyDashboardFilters(baseFilters({ preset: "7d" })));
    assert.doesNotThrow(() =>
      assertLegacyDashboardFilters(
        baseFilters({
          preset: "custom",
          startTimestamp: 1_700_000_000,
          endTimestamp: 1_700_000_000 + 2 * 86400,
        }),
      ),
    );
  });
});

describe("page and shell long-range safety (static)", () => {
  it("page long branch creates one packet promise and does not call legacy loaders there", () => {
    const page = readFileSync(PAGE_SOURCE, "utf8");
    assert.match(page, /resolveDashboardQueryPlan/);
    assert.match(page, /getDashboardRollupPacket/);
    assert.match(page, /DashboardRollupStatusPanel/);

    // Single packet promise creation (not four legacy loaders in rollup path).
    const packetPromiseMatches = page.match(/getDashboardRollupPacket\s*\(/g) ?? [];
    assert.equal(packetPromiseMatches.length, 1);

    // Legacy loaders remain available for short path only.
    assert.match(page, /getDashboardSummaryData/);
    assert.match(page, /getDashboardRankingData/);
    assert.match(page, /getDashboardStabilityData/);
    assert.match(page, /getDashboardTrendData/);

    // Long-range branch structure: unavailable and rollup kinds checked before legacy sections.
    const unavailableIdx = page.indexOf('plan.kind === "unavailable"') >= 0
      ? page.indexOf('plan.kind === "unavailable"')
      : page.indexOf('kind === "unavailable"');
    const rollupIdx = page.indexOf('plan.kind === "rollup"') >= 0
      ? page.indexOf('plan.kind === "rollup"')
      : page.indexOf('kind === "rollup"');
    const summarySectionIdx = page.indexOf("<SummarySection");
    assert.ok(unavailableIdx >= 0, "page must branch on unavailable");
    assert.ok(rollupIdx >= 0, "page must branch on rollup");
    assert.ok(summarySectionIdx >= 0, "page must retain legacy SummarySection");
    assert.ok(unavailableIdx < summarySectionIdx, "unavailable branch before legacy sections");
    assert.ok(rollupIdx < summarySectionIdx, "rollup branch before legacy sections");
  });

  it("dashboard query module classifies before logs min/max and guards raw loaders", () => {
    const source = readFileSync(DASHBOARD_QUERY_SOURCE, "utf8");
    assert.match(source, /export async function resolveDashboardQueryPlan/);
    assert.match(source, /assertLegacyDashboardFilters/);
    assert.match(source, /getDashboardData does not support long-range raw queries/);

    // getDashboardData must classify before MIN/MAX logs query.
    const getDataIdx = source.indexOf("export async function getDashboardData");
    assert.ok(getDataIdx >= 0);
    const dataSlice = source.slice(getDataIdx, getDataIdx + 800);
    const resolveInData = dataSlice.indexOf("resolveDashboardQueryPlan");
    const minMaxInData = dataSlice.indexOf("MIN(created_at)");
    assert.ok(resolveInData >= 0, "getDashboardData must call resolveDashboardQueryPlan");
    assert.ok(
      minMaxInData < 0 || resolveInData < minMaxInData,
      "classification must happen before raw MIN/MAX in getDashboardData",
    );
  });

  it("dashboard.ts has no second/unsafe legacy parseFilters or invalid custom source-bound fallbacks", () => {
    const source = readFileSync(DASHBOARD_QUERY_SOURCE, "utf8");

    // Dead duplicate parser must not remain beside parseDashboardRouteFilters.
    assert.doesNotMatch(
      source,
      /function parseFilters\s*\(/,
      "dashboard.ts must not keep a second legacy parseFilters",
    );

    // Invalid custom must never silently substitute source MIN/MAX bounds.
    assert.doesNotMatch(
      source,
      /parseShanghaiDateTimeInput\([^)]*\)\s*\?\?\s*minTimestamp/,
      "dashboard.ts must not fallback invalid custom start to minTimestamp",
    );
    assert.doesNotMatch(
      source,
      /parseShanghaiDateTimeInput\([^)]*\)\s*\?\?\s*maxTimestamp/,
      "dashboard.ts must not fallback invalid custom end to maxTimestamp",
    );

    // Active routing parser remains the single source of filter parsing.
    assert.match(source, /parseDashboardRouteFilters/);
  });

  it("routing module does not import db/query clients", () => {
    const source = readFileSync(ROUTING_SOURCE, "utf8");
    assert.doesNotMatch(source, /from ["']@\/lib\/db["']/);
    assert.doesNotMatch(source, /from ["']\.\.\/db\.ts["']/);
    assert.doesNotMatch(source, /\bquery\s*\(/);
  });
});

describe("token detail routing", () => {
  it("uses legacy for short presets and rollup/unavailable for long readiness states", async () => {
    const { resolveTokenDetailMode } = await import("./dashboard-routing.ts");
    assert.equal(
      resolveTokenDetailMode(
        baseFilters({ preset: "7d" }),
        ready,
        true,
      ),
      "legacy",
    );
    assert.equal(
      resolveTokenDetailMode(
        baseFilters({ preset: "30d" }),
        ready,
        true,
      ),
      "rollup",
    );
    assert.equal(
      resolveTokenDetailMode(
        baseFilters({ preset: "all" }),
        building,
        true,
      ),
      "unavailable",
    );
    assert.equal(
      resolveTokenDetailMode(
        baseFilters({
          preset: "custom",
          startTimestamp: 1_700_000_000,
          endTimestamp: 1_700_000_000 + 8 * 86400,
        }),
        ready,
        true,
      ),
      "unavailable",
    );
  });

  it("DI handler calls legacy only for legacy plans and never falls back after long classification", async () => {
    const { runTokenDetailRequest } = await import("./dashboard-routing.ts");

    const legacyDetail = {
      firstUsedAt: 1,
      activeModelCount: 1,
      activeChannelCount: 0,
      models: [],
      channels: [],
    };
    const rollupDetail = {
      firstUsedAt: 9,
      activeModelCount: 2,
      activeChannelCount: 1,
      models: [],
      channels: [],
    };

    const shortFilters = { preset: "7d" };
    const legacyPlanFilters = baseFilters({ preset: "7d", windowLabel: "近 7 天" });
    let legacyCalls = 0;
    let rollupCalls = 0;
    let resolveCalls = 0;
    const legacyResult = await runTokenDetailRequest(
      { tokenId: 0, tokenName: "tok", filters: shortFilters },
      {
        resolvePlan: async () => {
          resolveCalls += 1;
          return { kind: "legacy", filters: legacyPlanFilters };
        },
        getLegacyDetail: async (filters, tokenId, tokenName) => {
          legacyCalls += 1;
          // Must use resolved plan.filters so production skips re-resolve/bounds fetch.
          assert.deepEqual(filters, legacyPlanFilters);
          assert.notDeepEqual(filters, shortFilters);
          assert.equal(tokenId, 0);
          assert.equal(tokenName, "tok");
          return legacyDetail;
        },
        getRollupDetail: async () => {
          rollupCalls += 1;
          throw new Error("rollup should not run for legacy");
        },
      },
    );
    assert.equal(legacyResult.status, 200);
    assert.deepEqual(legacyResult.body, { detail: legacyDetail });
    assert.deepEqual(legacyResult.headers, NO_STORE_HEADERS);
    assert.equal(resolveCalls, 1);
    assert.equal(legacyCalls, 1);
    assert.equal(rollupCalls, 0);

    const rollupPlan = {
      kind: "rollup" as const,
      filters: baseFilters({ preset: "30d" }),
      version: 1,
      preset: "30d" as const,
      startTimestamp: 1,
      endTimestamp: 2,
      segments: [{ grain: 3 as const, start: 1, end: 2 }],
    };
    legacyCalls = 0;
    rollupCalls = 0;
    resolveCalls = 0;
    const rollupReady = await runTokenDetailRequest(
      { tokenId: 7, tokenName: "t7", filters: { preset: "30d" } },
      {
        resolvePlan: async () => {
          resolveCalls += 1;
          return rollupPlan;
        },
        getLegacyDetail: async () => {
          legacyCalls += 1;
          throw new Error("legacy must not run for rollup");
        },
        getRollupDetail: async (plan, token) => {
          rollupCalls += 1;
          assert.equal(plan.kind, "rollup");
          assert.equal(token.tokenId, 7);
          assert.equal(token.tokenName, "t7");
          return { kind: "ready", detail: rollupDetail };
        },
      },
    );
    assert.equal(rollupReady.status, 200);
    assert.deepEqual(rollupReady.body, { detail: rollupDetail });
    assert.deepEqual(rollupReady.headers, NO_STORE_HEADERS);
    assert.equal(resolveCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.equal(rollupCalls, 1);

    legacyCalls = 0;
    rollupCalls = 0;
    resolveCalls = 0;
    const rollupError = await runTokenDetailRequest(
      { tokenId: 7, tokenName: "t7", filters: { preset: "30d" } },
      {
        resolvePlan: async () => {
          resolveCalls += 1;
          return rollupPlan;
        },
        getLegacyDetail: async () => {
          legacyCalls += 1;
          throw new Error("no raw fallback after rollup error");
        },
        getRollupDetail: async () => {
          rollupCalls += 1;
          return { kind: "error", safeMessage: "长期统计暂时不可用，请稍后重试。" };
        },
      },
    );
    assert.equal(rollupError.status, 503);
    assert.equal(rollupError.body.error, "长期统计暂时不可用，请稍后重试。");
    assert.deepEqual(rollupError.headers, NO_STORE_HEADERS);
    assert.equal(resolveCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.equal(rollupCalls, 1);

    legacyCalls = 0;
    rollupCalls = 0;
    resolveCalls = 0;
    let loggedErrors = 0;
    const rollupThrow = await runTokenDetailRequest(
      { tokenId: 7, tokenName: "t7", filters: { preset: "30d" } },
      {
        resolvePlan: async () => {
          resolveCalls += 1;
          return rollupPlan;
        },
        getLegacyDetail: async () => {
          legacyCalls += 1;
          throw new Error("no raw fallback after rollup throw");
        },
        getRollupDetail: async () => {
          rollupCalls += 1;
          throw new Error("secret-rollup-stack");
        },
        logError: (error) => {
          loggedErrors += 1;
          assert.ok(error instanceof Error);
        },
      },
    );
    assert.equal(rollupThrow.status, 503);
    assert.equal(rollupThrow.body.error, "Failed to fetch token detail");
    assert.equal(JSON.stringify(rollupThrow.body).includes("secret-rollup-stack"), false);
    assert.deepEqual(rollupThrow.headers, NO_STORE_HEADERS);
    assert.equal(resolveCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.equal(rollupCalls, 1);
    assert.equal(loggedErrors, 1);

    legacyCalls = 0;
    rollupCalls = 0;
    resolveCalls = 0;
    const unavailableReadiness = building;
    const unavailable = await runTokenDetailRequest(
      { tokenId: 7, tokenName: "t7", filters: { preset: "all" } },
      {
        resolvePlan: async () => {
          resolveCalls += 1;
          return {
            kind: "unavailable",
            filters: baseFilters({ preset: "all" }),
            readiness: unavailableReadiness,
          };
        },
        getLegacyDetail: async () => {
          legacyCalls += 1;
          throw new Error("no raw fallback for unavailable");
        },
        getRollupDetail: async () => {
          rollupCalls += 1;
          throw new Error("rollup should not run for unavailable");
        },
      },
    );
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error, unavailableReadiness.safeMessage);
    assert.deepEqual(unavailable.body.readiness, unavailableReadiness);
    assert.deepEqual(unavailable.headers, NO_STORE_HEADERS);
    assert.equal(resolveCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.equal(rollupCalls, 0);
  });

  it("DI handler rejects invalid tokens and keeps unexpected errors generic without legacy fallback", async () => {
    const { runTokenDetailRequest } = await import("./dashboard-routing.ts");
    let legacyCalls = 0;
    let resolveCalls = 0;

    const invalid = await runTokenDetailRequest(
      { tokenId: Number.NaN, tokenName: "", filters: { preset: "7d" } },
      {
        resolvePlan: async () => {
          resolveCalls += 1;
          throw new Error("should not classify invalid token");
        },
        getLegacyDetail: async () => {
          legacyCalls += 1;
          throw new Error("should not load");
        },
        getRollupDetail: async () => {
          throw new Error("should not load");
        },
      },
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "Invalid token");
    assert.deepEqual(invalid.headers, NO_STORE_HEADERS);
    assert.equal(resolveCalls, 0);
    assert.equal(legacyCalls, 0);

    // tokenId 0 with nonempty name remains valid
    const zeroOk = await runTokenDetailRequest(
      { tokenId: 0, tokenName: "Unknown", filters: { preset: "7d" } },
      {
        resolvePlan: async () => ({ kind: "legacy", filters: baseFilters({ preset: "7d" }) }),
        getLegacyDetail: async (_f, tokenId, tokenName) => {
          legacyCalls += 1;
          assert.equal(tokenId, 0);
          assert.equal(tokenName, "Unknown");
          return {
            firstUsedAt: 0,
            activeModelCount: 0,
            activeChannelCount: 0,
            models: [],
            channels: [],
          };
        },
        getRollupDetail: async () => {
          throw new Error("no");
        },
      },
    );
    assert.equal(zeroOk.status, 200);
    assert.equal(legacyCalls, 1);

    legacyCalls = 0;
    const boom = await runTokenDetailRequest(
      { tokenId: 1, tokenName: "x", filters: { preset: "30d" } },
      {
        resolvePlan: async () => {
          throw new Error("secret-db-password-xyz");
        },
        getLegacyDetail: async () => {
          legacyCalls += 1;
          throw new Error("no fallback");
        },
        getRollupDetail: async () => {
          throw new Error("no");
        },
      },
    );
    assert.equal(boom.status, 500);
    assert.equal(boom.body.error, "Failed to fetch token detail");
    assert.equal(JSON.stringify(boom.body).includes("secret-db-password-xyz"), false);
    assert.deepEqual(boom.headers, NO_STORE_HEADERS);
    assert.equal(legacyCalls, 0);
  });

  it("token-detail route classifies before loaders and has no catch fallback to legacy", () => {
    const source = readFileSync(TOKEN_DETAIL_ROUTE_SOURCE, "utf8");
    const routing = readFileSync(ROUTING_SOURCE, "utf8");
    assert.match(source, /resolveDashboardQueryPlan/);
    assert.match(source, /getDashboardRollupTokenDetail/);
    assert.match(source, /runTokenDetailRequest/);
    assert.match(source, /getTokenDetailData/);

    // Route wires plan resolution + rollup before/instead of only legacy.
    assert.ok(source.includes("resolvePlan: resolveDashboardQueryPlan"));
    assert.ok(source.includes("getLegacyDetail: getTokenDetailData"));
    assert.ok(source.includes("getRollupDetail: getDashboardRollupTokenDetail"));
    assert.match(source, /headers:\s*result\.headers/);

    // No catch-block fallback that re-invokes legacy detail after failure.
    assert.doesNotMatch(
      source,
      /catch\s*\([^)]*\)\s*\{[\s\S]*getTokenDetailData/,
      "route must not call getTokenDetailData inside catch fallback",
    );
    // Cache headers owned by DI handler used by the route.
    assert.match(
      routing,
      /Cache-Control["']?\s*:\s*["']no-store, no-cache, must-revalidate["']/,
    );
    assert.match(routing, /export async function runTokenDetailRequest/);
    assert.match(routing, /plan\.kind === ["']legacy["']/);
    assert.match(routing, /plan\.kind === ["']unavailable["']/);
    // After rollup classification, never call legacy detail.
    assert.ok(routing.includes("// plan.kind === \"rollup\""));
    assert.doesNotMatch(
      routing.slice(routing.indexOf("// plan.kind === \"rollup\"")),
      /getLegacyDetail/,
      "rollup path must not call getLegacyDetail",
    );
    // Legacy load uses resolved plan.filters, not raw search params.
    assert.match(routing, /getLegacyDetail\(\s*plan\.filters/);
  });
});
