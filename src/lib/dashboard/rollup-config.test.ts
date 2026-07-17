import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DASHBOARD_DIMENSION_MASKS,
  DASHBOARD_ROLLUP_GRAINS,
  DASHBOARD_ROLLUP_VERSION,
  getDashboardRollupConfig,
} from "./rollup-config.ts";

describe("dashboard rollup config", () => {
  it("exposes formula version 1 and sparse mask/grain constants", () => {
    assert.equal(DASHBOARD_ROLLUP_VERSION, 1);
    assert.deepEqual(DASHBOARD_DIMENSION_MASKS, [0, 1, 2, 4, 8, 15]);
    assert.deepEqual(DASHBOARD_ROLLUP_GRAINS, {
      minute: 1,
      hour: 2,
      day: 3,
      all: 4,
    });
  });

  it("uses defaults batch=100 pause=500 timeout=5000 and disables worker/reads by default", () => {
    const config = getDashboardRollupConfig({});
    assert.equal(config.workerEnabled, false);
    assert.equal(config.readsEnabled, false);
    assert.equal(config.batchSize, 100);
    assert.equal(config.pauseMs, 500);
    assert.equal(config.statementTimeoutMs, 5000);
  });

  it("treats only explicit true-like values as enabled", () => {
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_WORKER_ENABLED: "false" }).workerEnabled, false);
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_WORKER_ENABLED: "0" }).workerEnabled, false);
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_WORKER_ENABLED: "no" }).workerEnabled, false);
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_WORKER_ENABLED: "true" }).workerEnabled, true);
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_READS_ENABLED: "1" }).readsEnabled, true);
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_READS_ENABLED: "yes" }).readsEnabled, true);
    assert.equal(getDashboardRollupConfig({ DASHBOARD_ROLLUP_READS_ENABLED: "on" }).readsEnabled, true);
  });

  it("clamps batch 10..1000, pause 100..60000, timeout 1000..60000", () => {
    const high = getDashboardRollupConfig({
      DASHBOARD_ROLLUP_BATCH_SIZE: "99999",
      DASHBOARD_ROLLUP_PAUSE_MS: "999999",
      DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS: "999999",
    });
    assert.equal(high.batchSize, 1000);
    assert.equal(high.pauseMs, 60_000);
    assert.equal(high.statementTimeoutMs, 60_000);

    const low = getDashboardRollupConfig({
      DASHBOARD_ROLLUP_BATCH_SIZE: "1",
      DASHBOARD_ROLLUP_PAUSE_MS: "0",
      DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS: "-1",
    });
    assert.equal(low.batchSize, 10);
    assert.equal(low.pauseMs, 100);
    assert.equal(low.statementTimeoutMs, 1000);
  });

  it("falls back to defaults for non-numeric env values", () => {
    const config = getDashboardRollupConfig({
      DASHBOARD_ROLLUP_BATCH_SIZE: "nope",
      DASHBOARD_ROLLUP_PAUSE_MS: "",
      DASHBOARD_ROLLUP_STATEMENT_TIMEOUT_MS: "NaN",
    });
    assert.equal(config.batchSize, 100);
    assert.equal(config.pauseMs, 500);
    assert.equal(config.statementTimeoutMs, 5000);
  });
});
