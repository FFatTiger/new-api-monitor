import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPredictionDurationMinutes, formatPredictionExhaustionLabel, shouldWarnPredictionBeforeReset } from "./usage-presentation.ts";

describe("quota usage presentation", () => {
  it("formats prediction duration with compact D H M units", () => {
    assert.equal(formatPredictionDurationMinutes(null), "--");
    assert.equal(formatPredictionDurationMinutes(0), "0M");
    assert.equal(formatPredictionDurationMinutes(0.4), "<1M");
    assert.equal(formatPredictionDurationMinutes(35), "35M");
    assert.equal(formatPredictionDurationMinutes(18 * 60), "18H");
    assert.equal(formatPredictionDurationMinutes(18 * 60 + 35), "18H 35M");
    assert.equal(formatPredictionDurationMinutes(2 * 1440 + 4 * 60), "2D 4H");
  });

  it("formats compact exhaustion labels", () => {
    assert.equal(formatPredictionExhaustionLabel("ready", 2 * 1440 + 4 * 60), "预计 2D 4H 耗尽");
    assert.equal(formatPredictionExhaustionLabel("ready", 35), "预计 35M 耗尽");
    assert.equal(formatPredictionExhaustionLabel("no_snapshot", null), "等待采样");
    assert.equal(formatPredictionExhaustionLabel("no_recent_usage", null), "暂无趋势");
    assert.equal(formatPredictionExhaustionLabel("exhausted", 0), "已耗尽");
    assert.equal(formatPredictionExhaustionLabel("unconfigured", null), "未配置");
  });

  it("warns when predicted exhaustion is before the next reset", () => {
    assert.equal(shouldWarnPredictionBeforeReset("ready", 1_500, "2000"), true);
    assert.equal(shouldWarnPredictionBeforeReset("ready", 1_500, "2000000"), true);
    assert.equal(shouldWarnPredictionBeforeReset("ready", 2_500, "2000"), false);
    assert.equal(shouldWarnPredictionBeforeReset("no_recent_usage", null, "2000"), false);
    assert.equal(shouldWarnPredictionBeforeReset("ready", 1_500, null), false);
  });
});
