import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMiniMaxQuotaData,
  getMiniMaxEndpointCandidates,
  normalizeMiniMaxApiKey,
  normalizeMiniMaxRegion,
  resolveMiniMaxPlanType,
} from "./minimax.ts";

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
          {
            model_name: "speech-hd",
            current_interval_total_count: 4000,
            current_interval_usage_count: 4000,
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
    assert.equal(data.windows?.length, 1);
    assert.equal(data.windows?.[0].label, "4小时额度");
    assert.equal(data.windows?.[0].usedPercent, 0.3);
    assert.equal(data.windows?.[0].remainingPercent, 99.7);
    assert.equal(Math.round((data.windows?.[0].usedPrompt || 0) * 100) / 100, 0.27);
    assert.equal(data.windows?.[0].valueLabel, "99.7/100P");
    assert.equal(data.windows?.[0].resetTime, 1780156800000);
  });

  it("adds a weekly window only when MiniMax returns a weekly total", () => {
    const data = buildMiniMaxQuotaData(
      {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
          {
            model_name: "MiniMax-M*",
            current_interval_total_count: 1500,
            current_interval_usage_count: 1500,
            end_time: 1780156800000,
            current_weekly_total_count: 3000,
            current_weekly_usage_count: 2400,
            weekly_end_time: 1780243200000,
          },
        ],
      },
      "global",
    );

    assert.equal(data.windows?.length, 2);
    assert.equal(data.windows?.[0].label, "4小时额度");
    assert.equal(data.windows?.[1].label, "周额度");
    assert.equal(data.windows?.[1].remainingPercent, 80);
    assert.equal(data.windows?.[1].valueLabel, "160/200P");
    assert.equal(data.windows?.[1].resetTime, 1780243200000);
  });

  it("maps prompt limits to domestic and international plan names", () => {
    assert.equal(resolveMiniMaxPlanType(40, "cn"), "starter");
    assert.equal(resolveMiniMaxPlanType(100, "cn"), "plus");
    assert.equal(resolveMiniMaxPlanType(100, "global"), "starter");
    assert.equal(resolveMiniMaxPlanType(300, "global"), "plus");
    assert.equal(resolveMiniMaxPlanType(1000, "global"), "max");
    assert.equal(resolveMiniMaxPlanType(2000, "cn"), "ultra");
  });

  it("tries the domestic endpoint first in auto mode and honors explicit region", () => {
    assert.deepEqual(
      getMiniMaxEndpointCandidates("auto").map((endpoint) => endpoint.region),
      ["cn", "global"],
    );
    assert.deepEqual(
      getMiniMaxEndpointCandidates("cn").map((endpoint) => endpoint.url),
      ["https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains"],
    );
  });

  it("ignores pasted comments after the api key and region env values", () => {
    assert.equal(normalizeMiniMaxApiKey("sk-cp-valid 试试"), "sk-cp-valid");
    assert.equal(normalizeMiniMaxRegion("cn 还是不行"), "cn");
  });
});
