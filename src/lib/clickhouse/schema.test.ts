import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLICKHOUSE_DDL } from "./schema.ts";

describe("clickhouse schema", () => {
  it("uses only ClickHouse-owned tables and a minute/full-dimension batch key", () => {
    const ddl = CLICKHOUSE_DDL.join("\n");
    assert.match(ddl, /dashboard_sync_state/);
    assert.match(ddl, /dashboard_dimensions/);
    assert.match(ddl, /dashboard_minute_batches/);
    assert.match(
      ddl,
      /ORDER BY \(bucket_start, model_name, channel_id, user_id, token_id, token_name, username, batch_id\)/,
    );
    assert.doesNotMatch(ddl, /\blogs\b/i);
    assert.doesNotMatch(ddl, /MATERIALIZED\s+VIEW/i);
  });
});
