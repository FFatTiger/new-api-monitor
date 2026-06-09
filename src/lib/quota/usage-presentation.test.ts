import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPredictionDurationMinutes, formatPredictionExhaustionLabel } from "./usage-presentation.ts";

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
    assert.equal(formatPredictionExhaustionLabel("safe_until_reset", null), "重置前安全");
    assert.equal(formatPredictionExhaustionLabel("exhausted", 0), "已耗尽");
    assert.equal(formatPredictionExhaustionLabel("unconfigured", null), "未配置");
  });
});
