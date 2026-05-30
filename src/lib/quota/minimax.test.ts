import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMiniMaxQuotaData, getMiniMaxEndpointCandidates, resolveMiniMaxPlanType } from "./minimax.ts";

describe("MiniMax quota compatibility", () => {
  it("normalizes remaining counts into used and remaining prompt quota", () => {
    const data = buildMiniMaxQuotaData(
      {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
          {
            model_name: "MiniMax-M*",
            current_interval_total_count: 1500,
            current_interval_usage_count: 1496,
            remains_time: 2840158,
            start_time: 1780142400000,
            end_time: 1780156800000,
          },
        ],
        category_remains: [
          {
            category: "text_generation",
            display_name: "文本生成",
            current_interval_total_count: 1500,
            current_interval_usage_count: 1496,
          },
        ],
      },
      "global",
    );

    assert.equal(data.planType, "starter");
    assert.equal(data.tierLabel, "Starter");
    assert.equal(data.windows?.[0].label, "MiniMax-M*");
    assert.equal(data.windows?.[0].usedPercent, 0.3);
    assert.equal(data.windows?.[0].remainingPercent, 99.7);
    assert.equal(Math.round((data.windows?.[0].usedPrompt || 0) * 100) / 100, 0.27);
    assert.equal(data.windows?.[0].valueLabel, "99.7/100P");
    assert.equal(data.windows?.[0].resetTime, 1780156800000);
    assert.equal(data.windows?.[1].label, "文本生成");
  });

  it("maps prompt limits to domestic and international plan names", () => {
    assert.equal(resolveMiniMaxPlanType(40, "cn"), "starter");
    assert.equal(resolveMiniMaxPlanType(100, "cn"), "plus");
    assert.equal(resolveMiniMaxPlanType(100, "global"), "starter");
    assert.equal(resolveMiniMaxPlanType(300, "global"), "plus");
    assert.equal(resolveMiniMaxPlanType(1000, "global"), "max");
    assert.equal(resolveMiniMaxPlanType(2000, "cn"), "ultra");
  });

  it("uses both endpoints in auto mode and honors explicit region", () => {
    assert.deepEqual(
      getMiniMaxEndpointCandidates("auto").map((endpoint) => endpoint.region),
      ["global", "cn"],
    );
    assert.deepEqual(
      getMiniMaxEndpointCandidates("cn").map((endpoint) => endpoint.url),
      ["https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains"],
    );
  });
});
