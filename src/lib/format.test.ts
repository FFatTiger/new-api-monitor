import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatOutputTokensPerSec, getCacheRatio } from "./format-metrics.ts";

describe("getCacheRatio", () => {
  it("returns cache token share of total input tokens", () => {
    assert.equal(getCacheRatio(1_000, 250), 0.25);
  });

  it("returns zero when there are no input tokens", () => {
    assert.equal(getCacheRatio(0, 100), 0);
  });
});

describe("formatOutputTokensPerSec", () => {
  it("rounds tokens per second to the nearest integer", () => {
    assert.equal(formatOutputTokensPerSec(42.4), "42");
    assert.equal(formatOutputTokensPerSec(42.6), "43");
  });

  it("returns dash for missing values", () => {
    assert.equal(formatOutputTokensPerSec(null), "-");
    assert.equal(formatOutputTokensPerSec(undefined), "-");
    assert.equal(formatOutputTokensPerSec(Number.NaN), "-");
  });
});
