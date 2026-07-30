import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateSyncBatch } from "./sync-worker.ts";
import type { DashboardSourceLogRow } from "../dashboard/types.ts";

const row = (id: number): DashboardSourceLogRow => ({
  id, created_at: 1_700_000_001, token_id: 1, token_name: "key", user_id: 2,
  username: "user", model_name: "model (x)", channel_id: 3, channel_name: "channel",
  prompt_tokens: 10, completion_tokens: 5, type: 2, use_time: 1,
  other: '{"cache_tokens":2,"usage_semantic":"openai","frt":0.2}',
});

describe("clickhouse sync aggregation", () => {
  it("uses a deterministic batch id and combines identical minute dimensions", () => {
    const cells = aggregateSyncBatch([row(10), row(11)]);
    assert.equal(cells.length, 1);
    assert.equal(cells[0]?.batch_id, "10");
    assert.equal(cells[0]?.version, "11");
    assert.equal(cells[0]?.request_count, "2");
    assert.equal(cells[0]?.input_tokens, "20");
    assert.equal(cells[0]?.output_tokens, "10");
  });

  it("does not split one dimension when only the channel display name changes", () => {
    const changed = { ...row(11), channel_name: "renamed channel" };
    const cells = aggregateSyncBatch([row(10), changed]);
    assert.equal(cells.length, 1);
    assert.equal(cells[0]?.channel_name, "renamed channel");
  });
});
