import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildZaiAuthIndex,
  buildZaiQuotaData,
  buildZaiQuotaWindows,
  getZaiApiKeysFromEnv,
  getZaiKeyForAuthIndex,
  getZaiSlotFromAuthIndex,
  isZaiAuthIndex,
  parseZaiApiKeysValue,
} from "./zai.ts";

describe("z.ai api key list", () => {
  it("splits comma separated keys, trims, drops empties and dedupes", () => {
    assert.deepEqual(parseZaiApiKeysValue(" key-a , key-b ,,key-a, , "), ["key-a", "key-b"]);
    assert.deepEqual(parseZaiApiKeysValue("key-a\uFF0Ckey-b"), ["key-a", "key-b"]);
    assert.deepEqual(parseZaiApiKeysValue(""), []);
    assert.deepEqual(parseZaiApiKeysValue(null), []);
  });

  it("prefers ZAI_API_KEYS and falls back to the legacy single key envs", () => {
    assert.deepEqual(getZaiApiKeysFromEnv({ ZAI_API_KEYS: "key-a,key-b", ZAI_API_KEY: "legacy" }), ["key-a", "key-b"]);
    assert.deepEqual(getZaiApiKeysFromEnv({ ZAI_API_KEY: "legacy" }), ["legacy"]);
    assert.deepEqual(getZaiApiKeysFromEnv({ ZAI_API_TOKEN: "token" }), ["token"]);
    assert.deepEqual(getZaiApiKeysFromEnv({ ZAI_API_KEYS: " , ", ZAI_API_KEY: "legacy" }), ["legacy"]);
    assert.deepEqual(getZaiApiKeysFromEnv({}), []);
  });
});

describe("z.ai auth index slots", () => {
  it("keeps slot 0 on the historical server-zai index", () => {
    assert.equal(buildZaiAuthIndex(0), "server-zai");
    assert.equal(getZaiSlotFromAuthIndex("server-zai"), 0);
  });

  it("maps extra slots to server-zai-N and back", () => {
    assert.equal(buildZaiAuthIndex(1), "server-zai-2");
    assert.equal(getZaiSlotFromAuthIndex("server-zai-2"), 1);
    assert.equal(buildZaiAuthIndex(4), "server-zai-5");
    assert.equal(getZaiSlotFromAuthIndex("server-zai-5"), 4);
  });

  it("rejects colliding or malformed indexes", () => {
    assert.equal(getZaiSlotFromAuthIndex("server-zai-1"), null);
    assert.equal(getZaiSlotFromAuthIndex("server-zai-01"), null);
    assert.equal(getZaiSlotFromAuthIndex("server-zai-x"), null);
    assert.equal(getZaiSlotFromAuthIndex("server-minimax"), null);
    assert.equal(isZaiAuthIndex("server-zai-3"), true);
    assert.equal(isZaiAuthIndex("server-zai-1"), false);
    assert.equal(isZaiAuthIndex("server-minimax"), false);
  });

  it("resolves the key for a slot and reports out-of-range indexes", () => {
    const keys = ["key-a", "key-b", "key-c"];
    assert.equal(getZaiKeyForAuthIndex("server-zai", keys), "key-a");
    assert.equal(getZaiKeyForAuthIndex("server-zai-3", keys), "key-c");
    assert.equal(getZaiKeyForAuthIndex("server-zai-4", keys), null);
    assert.equal(getZaiKeyForAuthIndex("server-minimax", keys), null);
    assert.equal(getZaiKeyForAuthIndex("server-zai", []), null);
  });
});

describe("z.ai quota compatibility", () => {
  it("treats percentage as a 0-100 used percentage even when the value is 1", () => {
    const windows = buildZaiQuotaWindows({
      data: {
        limits: [
          { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 15, nextResetTime: 1_800_000_000_000 },
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 1, nextResetTime: 1_800_000_100_000 },
        ],
      },
    });

    assert.deepEqual(
      windows.map((window) => window.id),
      ["tokens-limit", "time-limit"],
    );
    assert.equal(windows[0].label, "5小时额度");
    assert.equal(windows[1].label, "周额度");
    assert.equal(windows[0].usedPercent, 1);
    assert.equal(windows[0].remainingPercent, 99);
    assert.equal(windows[0].resetTime, 1_800_000_100_000);
  });

  it("accepts percent values already returned on a 0-100 scale", () => {
    const windows = buildZaiQuotaWindows({
      data: {
        limits: [{ type: "TOKENS_LIMIT", percentage: 75.3 }],
      },
    });

    assert.equal(windows[0].usedPercent, 75.3);
    assert.equal(windows[0].remainingPercent, 24.7);
  });

  it("preserves the account level as a plan badge", () => {
    const data = buildZaiQuotaData({
      data: {
        level: "pro",
        limits: [{ type: "TOKENS_LIMIT", percentage: 20 }],
      },
    });

    assert.equal(data.planType, "pro");
    assert.equal(data.tierLabel, "Pro");
  });
});
