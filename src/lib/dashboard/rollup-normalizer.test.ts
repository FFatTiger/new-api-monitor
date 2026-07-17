import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { DASHBOARD_DIMENSION_MASKS, DASHBOARD_ROLLUP_GRAINS } from "./rollup-config.ts";
import {
  accumulateDashboardRollupRows,
  accumulateNormalizedDashboardRows,
  assertDimensionKeyMatchesStored,
  buildDashboardDimensionKeys,
  emitDashboardRollupCells,
  getDashboardRollupFormula,
  hashDashboardDimensionKey,
  normalizeDashboardSourceRow,
} from "./rollup-normalizer.ts";
import type { DashboardDimensionKey, DashboardSourceLogRow } from "./types.ts";

function baseRow(overrides: Partial<DashboardSourceLogRow> = {}): DashboardSourceLogRow {
  return {
    id: 10,
    created_at: 1_700_000_030,
    token_id: 7,
    token_name: "k",
    user_id: 3,
    username: "alice",
    model_name: "gpt-4 (preview)",
    channel_id: 9,
    channel_name: "ch",
    prompt_tokens: 100,
    completion_tokens: 50,
    type: 2,
    use_time: 2,
    other: JSON.stringify({
      cache_tokens: 5,
      cache_creation_tokens_5m: 1,
      cache_creation_tokens_1h: 2,
      usage_semantic: "anthropic",
      frt: "1.5",
    }),
    ...overrides,
  };
}

describe("dashboard rollup normalizer formula v1", () => {
  it("preserves current formulas for valid rows with cache base+5m+1h, Anthropic input, model suffix, type 2, frt, response, speed", () => {
    const formula = getDashboardRollupFormula(1);
    const normalized = formula.normalize(baseRow());
    assert.equal(normalized.modelName, "gpt-4");
    assert.equal(normalized.cacheTokens, BigInt(8)); // 5 + 1 + 2
    assert.equal(normalized.inputTokens, BigInt(108)); // anthropic: prompt + cache
    assert.equal(normalized.outputTokens, BigInt(50));
    assert.equal(normalized.requestCount, BigInt(1));
    assert.equal(normalized.attemptCount, BigInt(1));
    assert.equal(normalized.successCount, BigInt(1));
    assert.equal(normalized.errorCount, BigInt(0));
    assert.equal(normalized.firstTokenLatency, 1.5);
    assert.equal(normalized.responseTime, 2);
    assert.equal(normalized.outputTokensPerSec, 25);
    assert.equal(normalized.malformedOther, false);
  });

  it("falls back to cache_creation_tokens when 5m/1h are absent or zero", () => {
    const absent = normalizeDashboardSourceRow(
      baseRow({
        other: JSON.stringify({
          cache_tokens: 1,
          cache_creation_tokens: 4,
          usage_semantic: "openai",
        }),
      }),
    );
    assert.equal(absent.cacheTokens, BigInt(5));
    assert.equal(absent.inputTokens, BigInt(100));

    const zero = normalizeDashboardSourceRow(
      baseRow({
        other: JSON.stringify({
          cache_tokens: 1,
          cache_creation_tokens_5m: 0,
          cache_creation_tokens_1h: 0,
          cache_creation_tokens: 4,
          usage_semantic: "openai",
        }),
      }),
    );
    assert.equal(zero.cacheTokens, BigInt(5));
  });

  it("does not add cache to input for non-Anthropic usage_semantic", () => {
    const normalized = normalizeDashboardSourceRow(
      baseRow({
        other: JSON.stringify({
          cache_tokens: 5,
          cache_creation_tokens_5m: 1,
          cache_creation_tokens_1h: 2,
          usage_semantic: "openai",
          frt: "1.5",
        }),
      }),
    );
    assert.equal(normalized.cacheTokens, BigInt(8));
    assert.equal(normalized.inputTokens, BigInt(100));
  });

  it("treats malformed JSON as zero derived metrics, keeps base, sets diagnostic", () => {
    const normalized = normalizeDashboardSourceRow(baseRow({ other: "{not-json" }));
    assert.equal(normalized.cacheTokens, BigInt(0));
    assert.equal(normalized.inputTokens, BigInt(100));
    assert.equal(normalized.outputTokens, BigInt(50));
    assert.equal(normalized.firstTokenLatency, null);
    assert.equal(normalized.malformedOther, true);
  });

  it("does not mark non-object/non-{ other as malformed and has zero derived metrics", () => {
    for (const other of [null, "", "plain-text", "[1,2]", "null"]) {
      const normalized = normalizeDashboardSourceRow(baseRow({ other }));
      assert.equal(normalized.malformedOther, false, String(other));
      assert.equal(normalized.cacheTokens, BigInt(0), String(other));
      assert.equal(normalized.inputTokens, BigInt(100), String(other));
      assert.equal(normalized.firstTokenLatency, null, String(other));
    }
  });

  it("rejects invalid first-token latency values: exponent, negative, alphabetic, empty", () => {
    for (const frt of ["1e3", "-1", "abc", ""]) {
      const normalized = normalizeDashboardSourceRow(baseRow({ other: JSON.stringify({ frt }) }));
      assert.equal(normalized.firstTokenLatency, null, frt);
    }
  });

  it("counts type 5 as attempt/error and unrelated type has no attempt", () => {
    const errorRow = normalizeDashboardSourceRow(baseRow({ type: 5, use_time: 0, completion_tokens: 0 }));
    assert.equal(errorRow.attemptCount, BigInt(1));
    assert.equal(errorRow.successCount, BigInt(0));
    assert.equal(errorRow.errorCount, BigInt(1));
    assert.equal(errorRow.responseTime, null);
    assert.equal(errorRow.outputTokensPerSec, null);

    const otherType = normalizeDashboardSourceRow(baseRow({ type: 1 }));
    assert.equal(otherType.attemptCount, BigInt(0));
    assert.equal(otherType.successCount, BigInt(0));
    assert.equal(otherType.errorCount, BigInt(0));
  });

  it("applies output-speed conditions only for type 2 with use_time>0 and completion_tokens>0", () => {
    assert.equal(
      normalizeDashboardSourceRow(baseRow({ type: 2, use_time: 0, completion_tokens: 50 })).outputTokensPerSec,
      null,
    );
    assert.equal(
      normalizeDashboardSourceRow(baseRow({ type: 2, use_time: 2, completion_tokens: 0 })).outputTokensPerSec,
      null,
    );
    assert.equal(
      normalizeDashboardSourceRow(baseRow({ type: 5, use_time: 2, completion_tokens: 50 })).outputTokensPerSec,
      null,
    );
    assert.equal(
      normalizeDashboardSourceRow(baseRow({ type: 2, use_time: 2, completion_tokens: 50 })).outputTokensPerSec,
      25,
    );
  });

  it("keeps IDs and token totals larger than Number.MAX_SAFE_INTEGER exact as bigint", () => {
    const big = BigInt("9007199254740993"); // MAX_SAFE_INTEGER + 2
    const normalized = normalizeDashboardSourceRow(
      baseRow({
        id: big.toString(),
        token_id: big.toString(),
        user_id: (big + BigInt(1)).toString(),
        channel_id: (big + BigInt(2)).toString(),
        prompt_tokens: big.toString(),
        completion_tokens: (big + BigInt(3)).toString(),
        other: JSON.stringify({
          cache_tokens: big.toString(),
          cache_creation_tokens: "0",
          usage_semantic: "openai",
        }),
      }),
    );
    assert.equal(normalized.sourceId, big);
    assert.equal(normalized.tokenId, big);
    assert.equal(normalized.userId, big + BigInt(1));
    assert.equal(normalized.channelId, big + BigInt(2));
    assert.equal(normalized.inputTokens, big);
    assert.equal(normalized.outputTokens, big + BigInt(3));
    assert.equal(normalized.cacheTokens, big);
  });

  it("rejects unsafe number integers instead of BigInt-rounding them", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1; // not Number.isSafeInteger
    assert.equal(Number.isSafeInteger(unsafe), false);

    assert.throws(() => normalizeDashboardSourceRow(baseRow({ id: unsafe })), /invalid id/i);

    const optionalId = normalizeDashboardSourceRow(baseRow({ token_id: unsafe, user_id: unsafe, channel_id: unsafe }));
    assert.equal(optionalId.tokenId, null);
    assert.equal(optionalId.userId, null);
    assert.equal(optionalId.channelId, null);

    const tokens = normalizeDashboardSourceRow(
      baseRow({
        prompt_tokens: unsafe,
        completion_tokens: unsafe,
        other: null,
      }),
    );
    assert.equal(tokens.inputTokens, BigInt(0));
    assert.equal(tokens.outputTokens, BigInt(0));
    assert.equal(tokens.malformedOther, true);

    // JSON integer fields that arrive as already-parsed unsafe numbers (via JSON text that
    // cannot be exact) are zeroed with diagnostic rather than BigInt(rounded).
    // Construct other by parsing then re-injecting is not available from source string alone
    // for unsafe magnitudes; use a formula path through object-like JSON with safe strings still ok.
    // Direct path: large exact string still works (covered above). For number form inside JSON,
    // JSON.stringify of unsafe yields a rounded decimal; parseOther receives that number after parse.
    const otherWithUnsafeNumber = `{"cache_tokens":${unsafe},"usage_semantic":"openai"}`;
    const fromOther = normalizeDashboardSourceRow(baseRow({ other: otherWithUnsafeNumber }));
    assert.equal(fromOther.cacheTokens, BigInt(0));
    assert.equal(fromOther.malformedOther, true);
  });

  it("rejects non-integer created_at numbers instead of truncating", () => {
    assert.throws(
      () => normalizeDashboardSourceRow(baseRow({ created_at: 1_700_000_030.75 })),
      /invalid created_at/i,
    );
  });

  it("does not emit rounded outputTokensPerSec when completion exceeds safe number conversion", () => {
    const huge = BigInt("9007199254740993");
    const normalized = normalizeDashboardSourceRow(
      baseRow({
        type: 2,
        use_time: 2,
        completion_tokens: huge.toString(),
        other: null,
      }),
    );
    assert.equal(normalized.outputTokens, huge);
    assert.equal(normalized.outputTokensPerSec, null);
  });

  it("normalizes null/blank model names to Unknown", () => {
    assert.equal(normalizeDashboardSourceRow(baseRow({ model_name: null })).modelName, "Unknown");
    assert.equal(normalizeDashboardSourceRow(baseRow({ model_name: "   " })).modelName, "Unknown");
    assert.equal(normalizeDashboardSourceRow(baseRow({ model_name: " (x)" })).modelName, "Unknown");
  });

  it("accepts numeric strings for other JSON number fields", () => {
    const normalized = normalizeDashboardSourceRow(
      baseRow({
        other: JSON.stringify({
          cache_tokens: "5",
          cache_creation_tokens_5m: "1",
          cache_creation_tokens_1h: "2",
          usage_semantic: "anthropic",
          frt: "2.25",
        }),
      }),
    );
    assert.equal(normalized.cacheTokens, BigInt(8));
    assert.equal(normalized.inputTokens, BigInt(108));
    assert.equal(normalized.firstTokenLatency, 2.25);
  });
});

describe("dashboard rollup dimension keys and hashes", () => {
  it("builds exactly six masks in sorted order with correct null fields", () => {
    const normalized = normalizeDashboardSourceRow(baseRow());
    const keys = buildDashboardDimensionKeys(normalized);
    assert.deepEqual(
      keys.map((key) => key.dimensionMask),
      [...DASHBOARD_DIMENSION_MASKS],
    );

    const byMask = Object.fromEntries(keys.map((key) => [key.dimensionMask, key]));
    assert.deepEqual(
      {
        tokenId: byMask[0].tokenId,
        tokenName: byMask[0].tokenName,
        userId: byMask[0].userId,
        username: byMask[0].username,
        modelName: byMask[0].modelName,
        channelId: byMask[0].channelId,
      },
      {
        tokenId: null,
        tokenName: null,
        userId: null,
        username: null,
        modelName: null,
        channelId: null,
      },
    );
    assert.equal(byMask[1].tokenId, BigInt(7));
    assert.equal(byMask[1].tokenName, "k");
    assert.equal(byMask[1].userId, null);
    assert.equal(byMask[1].modelName, null);
    assert.equal(byMask[1].channelId, null);

    assert.equal(byMask[2].userId, BigInt(3));
    assert.equal(byMask[2].username, "alice");
    assert.equal(byMask[2].tokenId, null);
    assert.equal(byMask[2].modelName, null);

    assert.equal(byMask[4].modelName, "gpt-4");
    assert.equal(byMask[4].tokenId, null);
    assert.equal(byMask[4].userId, null);
    assert.equal(byMask[4].channelId, null);

    assert.equal(byMask[8].channelId, BigInt(9));
    assert.equal(byMask[8].tokenId, null);
    assert.equal(byMask[8].modelName, null);

    assert.equal(byMask[15].tokenId, BigInt(7));
    assert.equal(byMask[15].tokenName, "k");
    assert.equal(byMask[15].userId, BigInt(3));
    assert.equal(byMask[15].username, "alice");
    assert.equal(byMask[15].modelName, "gpt-4");
    assert.equal(byMask[15].channelId, BigInt(9));

    for (const key of keys) {
      assert.ok(Buffer.isBuffer(key.hash));
      assert.equal(key.hash.length, 32);
      assert.deepEqual(key.hash, hashDashboardDimensionKey(key));
    }
  });

  it("distinguishes null, empty string, zero, and string zero in dimension hashes", () => {
    const a = hashDashboardDimensionKey({
      dimensionMask: 1,
      tokenId: BigInt(0),
      tokenName: "",
      userId: null,
      username: null,
      modelName: null,
      channelId: null,
    });
    const b = hashDashboardDimensionKey({
      dimensionMask: 1,
      tokenId: null,
      tokenName: "",
      userId: null,
      username: null,
      modelName: null,
      channelId: null,
    });
    const c = hashDashboardDimensionKey({
      dimensionMask: 1,
      tokenId: BigInt(0),
      tokenName: null,
      userId: null,
      username: null,
      modelName: null,
      channelId: null,
    });
    const d = hashDashboardDimensionKey({
      dimensionMask: 1,
      tokenId: null,
      tokenName: "0",
      userId: null,
      username: null,
      modelName: null,
      channelId: null,
    });
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.notDeepEqual(b, c);
    assert.notDeepEqual(c, d);
    assert.equal(a.length, 32);
    assert.equal(createHash("sha256").update(a).digest("hex").length, 64);
  });

  it("assertDimensionKeyMatchesStored compares mask and all key fields", () => {
    const expected: DashboardDimensionKey = {
      dimensionMask: 15,
      tokenId: BigInt(1),
      tokenName: "t",
      userId: BigInt(2),
      username: "u",
      modelName: "m",
      channelId: BigInt(3),
    };
    assert.doesNotThrow(() => assertDimensionKeyMatchesStored(expected, { ...expected }));
    assert.throws(
      () =>
        assertDimensionKeyMatchesStored(expected, {
          ...expected,
          tokenName: "other",
        }),
      /collision|mismatch/i,
    );
    assert.throws(
      () =>
        assertDimensionKeyMatchesStored(expected, {
          ...expected,
          dimensionMask: 1,
        }),
      /collision|mismatch/i,
    );
  });
});

describe("dashboard rollup cell emission and accumulation", () => {
  it("emits exactly 24 cells, six per grain codes 1/2/3/4", () => {
    const normalized = normalizeDashboardSourceRow(baseRow());
    const keys = buildDashboardDimensionKeys(normalized);
    const cells = emitDashboardRollupCells(normalized, keys);
    assert.equal(cells.length, 24);
    for (const mask of DASHBOARD_DIMENSION_MASKS) {
      const grains = cells
        .filter((cell) => cell.dimensionMask === mask)
        .map((cell) => cell.grain)
        .sort((a, b) => a - b);
      assert.deepEqual(grains, [
        DASHBOARD_ROLLUP_GRAINS.minute,
        DASHBOARD_ROLLUP_GRAINS.hour,
        DASHBOARD_ROLLUP_GRAINS.day,
        DASHBOARD_ROLLUP_GRAINS.all,
      ]);
    }
    const counts = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    };
    for (const cell of cells) {
      counts[cell.grain] += 1;
    }
    assert.deepEqual(counts, { 1: 6, 2: 6, 3: 6, 4: 6 });
    const allTime = cells.filter((cell) => cell.grain === DASHBOARD_ROLLUP_GRAINS.all);
    assert.equal(allTime.length, 6);
    assert.ok(allTime.every((cell) => cell.bucketStart === 0));

    const sample = cells[0];
    assert.equal(sample.metrics.requestCount, BigInt(1));
    assert.equal(sample.metrics.inputTokens, BigInt(108));
    assert.equal(sample.metrics.firstTokenLatencySum, 1.5);
    assert.equal(sample.metrics.firstTokenLatencyCount, BigInt(1));
    assert.equal(sample.metrics.responseTimeSum, 2);
    assert.equal(sample.metrics.responseTimeCount, BigInt(1));
    assert.equal(sample.metrics.outputTokensPerSecSum, 25);
    assert.equal(sample.metrics.outputTokensPerSecCount, BigInt(1));
    assert.equal(sample.metrics.representativeUserId, BigInt(3));
    assert.equal(sample.metrics.representativeUsername, "alice");
    assert.equal(sample.metrics.representativeChannelName, "ch");
    assert.equal(sample.metrics.firstUsedAt, 1_700_000_030);
    assert.equal(sample.metrics.latestUsedAt, 1_700_000_030);
  });

  it("merges two rows in same minute/hour/day/dimension to six dimensions and 24 cells", () => {
    const result = accumulateDashboardRollupRows([
      baseRow({ id: 1, created_at: 1_700_000_030 }),
      baseRow({ id: 2, created_at: 1_700_000_031 }),
    ]);
    assert.equal(result.malformedOtherRows, 0);
    assert.equal(result.dimensions.length, 6);
    assert.equal(result.cells.length, 24);
    const globalMinute = result.cells.find(
      (cell) => cell.grain === DASHBOARD_ROLLUP_GRAINS.minute && cell.dimensionMask === 0,
    );
    assert.ok(globalMinute);
    assert.equal(globalMinute.metrics.requestCount, BigInt(2));
    assert.equal(globalMinute.metrics.inputTokens, BigInt(216));
    assert.equal(globalMinute.metrics.firstUsedAt, 1_700_000_030);
    assert.equal(globalMinute.metrics.latestUsedAt, 1_700_000_031);
  });

  it("does not merge rows that cross hour/day grain boundaries incorrectly", () => {
    // 1_700_000_000 = 2023-11-14 22:13:20 UTC
    // Choose two timestamps that share a minute? No — different hours.
    // 1_700_000_030 is within some hour; 1_700_003_630 is +1 hour.
    const early = 1_700_000_030;
    const later = early + 3600; // next hour, still same Shanghai day likely
    const result = accumulateDashboardRollupRows([
      baseRow({ id: 1, created_at: early }),
      baseRow({ id: 2, created_at: later }),
    ]);
    const hourCells = result.cells.filter(
      (cell) => cell.grain === DASHBOARD_ROLLUP_GRAINS.hour && cell.dimensionMask === 0,
    );
    assert.equal(hourCells.length, 2);
    assert.ok(hourCells.every((cell) => cell.metrics.requestCount === BigInt(1)));

    // Cross Shanghai day boundary: day start for early then day+1.
    // 2024-01-01 15:59:30 UTC is still previous Shanghai day vs 16:00:30.
    const beforeShanghaiMidnight = Date.UTC(2024, 0, 1, 15, 59, 30) / 1000;
    const afterShanghaiMidnight = Date.UTC(2024, 0, 1, 16, 0, 30) / 1000;
    const dayResult = accumulateDashboardRollupRows([
      baseRow({ id: 3, created_at: beforeShanghaiMidnight }),
      baseRow({ id: 4, created_at: afterShanghaiMidnight }),
    ]);
    const dayCells = dayResult.cells.filter(
      (cell) => cell.grain === DASHBOARD_ROLLUP_GRAINS.day && cell.dimensionMask === 0,
    );
    assert.equal(dayCells.length, 2);
    assert.ok(dayCells.every((cell) => cell.metrics.requestCount === BigInt(1)));

    // All-time still merges.
    const allCells = dayResult.cells.filter(
      (cell) => cell.grain === DASHBOARD_ROLLUP_GRAINS.all && cell.dimensionMask === 0,
    );
    assert.equal(allCells.length, 1);
    assert.equal(allCells[0].metrics.requestCount, BigInt(2));
  });

  it("merges representative fields with numeric max and lexicographic max ignoring null/empty", () => {
    const result = accumulateDashboardRollupRows([
      baseRow({
        id: 1,
        user_id: 3,
        username: "alice",
        channel_name: "alpha",
      }),
      baseRow({
        id: 2,
        user_id: 9,
        username: "bob",
        channel_name: "",
      }),
      baseRow({
        id: 3,
        user_id: null,
        username: null,
        channel_name: "zeta",
      }),
    ]);
    const global = result.cells.find(
      (cell) => cell.grain === DASHBOARD_ROLLUP_GRAINS.all && cell.dimensionMask === 0,
    );
    assert.ok(global);
    assert.equal(global.metrics.representativeUserId, BigInt(9));
    assert.equal(global.metrics.representativeUsername, "bob");
    assert.equal(global.metrics.representativeChannelName, "zeta");
  });

  it("counts malformed other rows in accumulation", () => {
    const result = accumulateDashboardRollupRows([
      baseRow({ id: 1, other: "{bad" }),
      baseRow({ id: 2 }),
    ]);
    assert.equal(result.malformedOtherRows, 1);
  });

  it("rejects unknown formula versions", () => {
    assert.throws(() => getDashboardRollupFormula(999), /unknown/i);
  });

  it("throws on dimension hash collision before merging mismatched keys", () => {
    const a = normalizeDashboardSourceRow(
      baseRow({
        id: 1,
        token_id: 1,
        token_name: "alpha",
        user_id: null,
        username: null,
        model_name: null,
        channel_id: null,
        channel_name: null,
      }),
    );
    const b = normalizeDashboardSourceRow(
      baseRow({
        id: 2,
        token_id: 2,
        token_name: "beta",
        user_id: null,
        username: null,
        model_name: null,
        channel_id: null,
        channel_name: null,
      }),
    );

    // Production-generic injected hash: encode only the mask so different masks still
    // differ within a row, but distinct token/user/model/channel values collide across rows.
    const hashFn = (key: DashboardDimensionKey) => {
      const buf = Buffer.alloc(32, 0);
      buf.writeUInt16BE(key.dimensionMask, 0);
      return buf;
    };

    assert.throws(
      () => accumulateNormalizedDashboardRows([a, b], hashFn),
      /collision|mismatch/i,
    );

    // Same dimension identity must still merge cleanly under the injected hash.
    const same = accumulateNormalizedDashboardRows([a, { ...a, sourceId: BigInt(99) }], hashFn);
    assert.equal(same.dimensions.length, 6);
  });
});
