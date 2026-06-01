import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMiniMaxQuotaData,
  getMiniMaxEndpointCandidates,
  normalizeMiniMaxApiKey,
  normalizeMiniMaxRegion,
} from "./minimax.ts";

describe("MiniMax quota compatibility", () => {
  it("normalizes the new general model hourly and weekly percentage limits", () => {
    const data = buildMiniMaxQuotaData(
      {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
          {
            model_name: "general",
            start_time: 1780261200000,
            end_time: 1780279200000,
            remains_time: 4628310,
            current_interval_total_count: 0,
            current_interval_usage_count: 0,
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            weekly_start_time: 1780243200000,
            weekly_end_time: 1780848000000,
            weekly_remains_time: 573428310,
            current_interval_status: 1,
            current_interval_remaining_percent: 99,
            current_weekly_status: 3,
            current_weekly_remaining_percent: 100,
          },
          {
            model_name: "video",
            start_time: 1780243200000,
            end_time: 1780329600000,
            current_interval_remaining_percent: 100,
            weekly_end_time: 1780848000000,
            current_weekly_remaining_percent: 100,
          },
        ],
      },
      "cn",
    );

    assert.equal(data.planType, undefined);
    assert.equal(data.tierLabel, null);
    assert.equal(data.windows?.length, 2);
    assert.equal(data.windows?.[0].id, "minimax-hour");
    assert.equal(data.windows?.[0].label, "5小时额度");
    assert.equal(data.windows?.[0].usedPercent, 1);
    assert.equal(data.windows?.[0].remainingPercent, 99);
    assert.equal(data.windows?.[0].valueLabel, "99%");
    assert.equal(data.windows?.[0].resetTime, 1780279200000);
    assert.equal(data.windows?.[1].id, "minimax-week");
    assert.equal(data.windows?.[1].label, "周额度");
    assert.equal(data.windows?.[1].usedPercent, 0);
    assert.equal(data.windows?.[1].remainingPercent, 100);
    assert.equal(data.windows?.[1].valueLabel, "100%");
    assert.equal(data.windows?.[1].resetTime, 1780848000000);
  });

  it("does not parse legacy prompt count limits without percentage fields", () => {
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

    assert.equal(data.windows?.length, 0);
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
