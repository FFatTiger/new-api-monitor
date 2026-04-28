import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCacheRatio } from "./format";

describe("getCacheRatio", () => {
  it("returns cache token share of total input tokens", () => {
    assert.equal(getCacheRatio(1_000, 250), 0.25);
  });

  it("returns zero when there are no input tokens", () => {
    assert.equal(getCacheRatio(0, 100), 0);
  });
});
