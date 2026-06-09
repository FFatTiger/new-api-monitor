import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_QUOTA_SNAPSHOT_INTERVAL_SECONDS,
  DEFAULT_QUOTA_USAGE_WINDOW_MINUTES,
  getQuotaSnapshotIntervalSecondsFromEnv,
  normalizeQuotaSnapshotIntervalSeconds,
  normalizeQuotaUsageWindowMinutes,
  parseQuotaUsageGroups,
  QUOTA_USAGE_WINDOW_OPTIONS,
} from "./usage-config.ts";

describe("quota usage config", () => {
  it("parses provider channel groups from semicolon config", () => {
    assert.deepEqual(parseQuotaUsageGroups("codex=8,17,19; claude=12 ;zai=27;bad;minimax=x,24"), {
      codex: [8, 17, 19],
      claude: [12],
      zai: [27],
      minimax: [24],
    });
  });

  it("deduplicates channels and ignores invalid provider keys", () => {
    assert.deepEqual(parseQuotaUsageGroups("codex=8,8,0,-1;unknown=1;gemini-cli=44"), {
      codex: [8],
      "gemini-cli": [44],
    });
  });

  it("normalizes window minutes to supported values", () => {
    assert.equal(DEFAULT_QUOTA_USAGE_WINDOW_MINUTES, 180);
    assert.deepEqual(QUOTA_USAGE_WINDOW_OPTIONS.map((option) => option.minutes), [60, 180, 360, 720, 1440]);
    assert.equal(normalizeQuotaUsageWindowMinutes("60"), 60);
    assert.equal(normalizeQuotaUsageWindowMinutes("180"), 180);
    assert.equal(normalizeQuotaUsageWindowMinutes("360"), 360);
    assert.equal(normalizeQuotaUsageWindowMinutes("720"), 720);
    assert.equal(normalizeQuotaUsageWindowMinutes("1440"), 1440);
    assert.equal(normalizeQuotaUsageWindowMinutes("15"), 180);
    assert.equal(normalizeQuotaUsageWindowMinutes(undefined), 180);
  });

  it("normalizes quota snapshot interval seconds with a five minute default", () => {
    assert.equal(DEFAULT_QUOTA_SNAPSHOT_INTERVAL_SECONDS, 300);
    assert.equal(normalizeQuotaSnapshotIntervalSeconds("60"), 60);
    assert.equal(normalizeQuotaSnapshotIntervalSeconds("300"), 300);
    assert.equal(normalizeQuotaSnapshotIntervalSeconds("0"), 300);
    assert.equal(normalizeQuotaSnapshotIntervalSeconds("bad"), 300);
    assert.equal(getQuotaSnapshotIntervalSecondsFromEnv({ QUOTA_SNAPSHOT_INTERVAL_SECONDS: "120" }), 120);
    assert.equal(
      getQuotaSnapshotIntervalSecondsFromEnv({
        NEW_API_MONITOR_QUOTA_SNAPSHOT_INTERVAL_SECONDS: "180",
      }),
      180,
    );
  });
});
