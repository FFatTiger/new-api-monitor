import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { Pool, type PoolClient } from "pg";

import type { DbClient } from "../db.ts";
import { runInTransaction } from "../db.ts";
import { getDashboardRollupConfig } from "./rollup-config.ts";
import {
  ensureDashboardRollupSchema,
  initializeDashboardRollupRegistry,
} from "./rollup-schema.ts";
import {
  processDashboardRollupWorkItem,
  selectDashboardRollupWorkItem,
} from "./rollup-store.ts";

const url = process.env.DASHBOARD_ROLLUP_TEST_DATABASE_URL;

describe("dashboard rollup store integration", { skip: !url }, () => {
  it("refuses to use ordinary DATABASE_URL as a fallback", () => {
    assert.ok(url);
    // Must never silently fall back; dedicated URL is required for this suite.
    if (process.env.DATABASE_URL) {
      assert.notEqual(url, process.env.DATABASE_URL);
    }
  });

  it("processes a live batch with rollback exactly-once semantics and permanent cells", async () => {
    assert.ok(url);
    const schema = `dash_rollup_${randomUUID().replace(/-/g, "")}`;
    const pool = new Pool({ connectionString: url, max: 2 });
    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);

      // Fixture logs table with required columns (application never creates this in prod).
      await client.query(`
        CREATE TABLE logs (
          id BIGINT PRIMARY KEY,
          created_at BIGINT NOT NULL,
          token_id BIGINT,
          token_name TEXT,
          user_id BIGINT,
          username TEXT,
          model_name TEXT,
          channel_id BIGINT,
          channel_name TEXT,
          prompt_tokens BIGINT,
          completion_tokens BIGINT,
          type BIGINT,
          use_time DOUBLE PRECISION,
          other TEXT
        )
      `);

      const db = client as unknown as DbClient;
      await ensureDashboardRollupSchema(db);

      // Seed a few source rows
      const now = Math.floor(Date.now() / 1000);
      await client.query(
        `INSERT INTO logs (
           id, created_at, token_id, token_name, user_id, username, model_name,
           channel_id, channel_name, prompt_tokens, completion_tokens, type, use_time, other
         ) VALUES
           (1, $1, 10, 'tok', 20, 'alice', 'gpt', 30, 'ch', 5, 3, 2, 1.0, NULL),
           (2, $1, 10, 'tok', 20, 'alice', 'gpt', 30, 'ch', 5, 3, 2, 1.0, NULL),
           (3, $1, 10, 'tok', 20, 'alice', 'gpt', 30, 'ch', 5, 3, 2, 1.0, NULL)`,
        [now],
      );

      await runInTransaction(db, async (tx) => {
        await initializeDashboardRollupRegistry(tx, [1], 1, now);
      });

      // Force live_cursor behind so live lane has work: re-init leaves cursor at max id.
      // Move live cursor down for smoke test of processing.
      await client.query(
        `UPDATE dashboard_rollup_state
         SET live_cursor_id = 0, history_cursor_id = 4, history_complete = false
         WHERE version = 1`,
      );

      const config = getDashboardRollupConfig({
        DASHBOARD_ROLLUP_WORKER_ENABLED: "true",
        DASHBOARD_ROLLUP_BATCH_SIZE: "100",
      });

      // Force mid-batch failure: process in a transaction that rolls back after claims would land.
      await assert.rejects(async () => {
        await runInTransaction(db, async (tx) => {
          const work = await selectDashboardRollupWorkItem(tx, now);
          assert.ok(work);
          await processDashboardRollupWorkItem(tx, work!, config, now);
          throw new Error("forced transactional failure");
        });
      }, /forced transactional failure/);

      const claimsAfterRollback = await client.query(
        `SELECT count(*)::text AS c FROM dashboard_rollup_processed_sources`,
      );
      assert.equal(
        (claimsAfterRollback.rows[0] as { c: string }).c,
        "0",
        "claims must roll back with the failed transaction",
      );

      // Retry successfully — live from cursor 0 should claim all three fixture rows once.
      const result = await runInTransaction(db, async (tx) => {
        const work = await selectDashboardRollupWorkItem(tx, now);
        assert.ok(work);
        return processDashboardRollupWorkItem(tx, work!, config, now);
      });

      assert.equal(result.claimedRows, 3);
      assert.equal(result.fetchedRows, 3);
      assert.equal(result.liveCursorId, "3");

      const claims = await client.query(
        `SELECT count(*)::text AS c FROM dashboard_rollup_processed_sources WHERE version = 1`,
      );
      assert.equal(Number((claims.rows[0] as { c: string }).c), 3);

      const requestTotal = await client.query(
        `SELECT coalesce(sum(request_count), 0)::text AS s
         FROM dashboard_rollups
         WHERE version = 1 AND grain = 4 AND dimension_id IN (
           SELECT id FROM dashboard_rollup_dimensions
           WHERE version = 1 AND dimension_mask = 0
         )`,
      );
      // 3 sources × 1 request each on global mask all-time grain
      assert.equal(Number((requestTotal.rows[0] as { s: string }).s), 3);

      // Exactly-once: second live process claims zero and metrics stay unchanged.
      const second = await runInTransaction(db, async (tx) => {
        return processDashboardRollupWorkItem(
          tx,
          { lane: "live", version: 1 },
          config,
          now + 1,
        );
      });
      assert.equal(second.claimedRows, 0);
      assert.equal(second.fetchedRows, 0);

      const claims2 = await client.query(
        `SELECT count(*)::text AS c FROM dashboard_rollup_processed_sources WHERE version = 1`,
      );
      assert.equal(Number((claims2.rows[0] as { c: string }).c), 3, "retry must not double-claim");

      const requestTotal2 = await client.query(
        `SELECT coalesce(sum(request_count), 0)::text AS s
         FROM dashboard_rollups
         WHERE version = 1 AND grain = 4 AND dimension_id IN (
           SELECT id FROM dashboard_rollup_dimensions
           WHERE version = 1 AND dimension_mask = 0
         )`,
      );
      assert.equal(
        Number((requestTotal2.rows[0] as { s: string }).s),
        3,
        "metrics must not double-count on retry",
      );

      // Four grains present for claimed sources
      const grains = await client.query(
        `SELECT DISTINCT grain FROM dashboard_rollups WHERE version = 1 ORDER BY grain`,
      );
      const grainSet = new Set(
        (grains.rows as Array<{ grain: number }>).map((r) => Number(r.grain)),
      );
      for (const g of [1, 2, 3, 4]) {
        assert.ok(grainSet.has(g), `missing grain ${g}`);
      }

      // Six dimension masks
      const masks = await client.query(
        `SELECT DISTINCT dimension_mask FROM dashboard_rollup_dimensions WHERE version = 1 ORDER BY dimension_mask`,
      );
      const maskSet = new Set(
        (masks.rows as Array<{ dimension_mask: number }>).map((r) => Number(r.dimension_mask)),
      );
      for (const m of [0, 1, 2, 4, 8, 15]) {
        assert.ok(maskSet.has(m), `missing mask ${m}`);
      }

      // Source deletion must not delete rollups
      await client.query(`DELETE FROM logs`);
      const rollupCount = await client.query(
        `SELECT count(*)::text AS c FROM dashboard_rollups WHERE version = 1`,
      );
      assert.ok(Number((rollupCount.rows[0] as { c: string }).c) > 0);
    } finally {
      try {
        if (client) {
          await client.query(`SET search_path TO ${schema}`);
          await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
      } catch {
        // best-effort cleanup
      }
      client?.release();
      await pool.end();
    }
  });
});
