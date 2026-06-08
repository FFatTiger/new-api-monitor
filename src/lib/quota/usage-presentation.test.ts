import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPredictionDurationMinutes } from "./usage-presentation.ts";

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
});
