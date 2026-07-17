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
const SEVEN_DAYS = 7 * 24 * 60 * 60;

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

  it("routing module does not import db/query clients", () => {
    const source = readFileSync(ROUTING_SOURCE, "utf8");
    assert.doesNotMatch(source, /from ["']@\/lib\/db["']/);
    assert.doesNotMatch(source, /from ["']\.\.\/db\.ts["']/);
    assert.doesNotMatch(source, /\bquery\s*\(/);
  });
});
