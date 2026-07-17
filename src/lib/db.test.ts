import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runInTransaction,
  type DbClient,
  type TransactionOptions,
} from "./db.ts";

type QueryCall = {
  text: string;
  values?: unknown[];
};

function createFakeClient(handlers: {
  onQuery?: (text: string, values?: unknown[]) => unknown | Promise<unknown>;
} = {}) {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (handlers.onQuery) {
        return handlers.onQuery(text, values);
      }
      return { rows: [], rowCount: 0 };
    },
  } as DbClient;
  return { client, calls };
}

describe("runInTransaction", () => {
  it("begins, applies configured settings, runs callback, then commits in order", async () => {
    const { client, calls } = createFakeClient();
    const options: TransactionOptions = {
      statementTimeoutMs: 1500,
      disableParallelGather: true,
      isolationLevel: "read committed",
    };

    const result = await runInTransaction(
      client,
      async (tx) => {
        await tx.query("SELECT 1");
        return "ok";
      },
      options,
    );

    assert.equal(result, "ok");
    assert.deepEqual(
      calls.map((c) => c.text),
      [
        "BEGIN ISOLATION LEVEL READ COMMITTED",
        "SELECT set_config($1, $2, true)",
        "SELECT set_config($1, $2, true)",
        "SELECT 1",
        "COMMIT",
      ],
    );
    assert.deepEqual(calls[1]?.values, ["statement_timeout", "1500"]);
    assert.deepEqual(calls[2]?.values, ["max_parallel_workers_per_gather", "0"]);
  });

  it("begins with REPEATABLE READ READ ONLY for packet reads", async () => {
    const { client, calls } = createFakeClient();

    await runInTransaction(
      client,
      async () => "done",
      {
        isolationLevel: "repeatable read",
        readOnly: true,
      },
    );

    assert.equal(calls[0]?.text, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1)?.text, "COMMIT");
  });

  it("uses plain BEGIN when no isolation or readOnly options are set", async () => {
    const { client, calls } = createFakeClient();

    await runInTransaction(client, async () => 42);

    assert.equal(calls[0]?.text, "BEGIN");
    assert.equal(calls.at(-1)?.text, "COMMIT");
  });

  it("rolls back and rethrows when the callback fails", async () => {
    const { client, calls } = createFakeClient();
    const failure = new Error("callback failed");

    await assert.rejects(
      () =>
        runInTransaction(client, async () => {
          throw failure;
        }),
      (error: unknown) => {
        assert.equal(error, failure);
        return true;
      },
    );

    assert.deepEqual(
      calls.map((c) => c.text),
      ["BEGIN", "ROLLBACK"],
    );
  });

  it("attempts rollback and rethrows when COMMIT fails", async () => {
    const commitError = new Error("commit failed");
    const { client, calls } = createFakeClient({
      onQuery(text) {
        if (text === "COMMIT") {
          throw commitError;
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await assert.rejects(
      () => runInTransaction(client, async () => "ok"),
      (error: unknown) => {
        assert.equal(error, commitError);
        return true;
      },
    );

    assert.deepEqual(
      calls.map((c) => c.text),
      ["BEGIN", "COMMIT", "ROLLBACK"],
    );
  });

  it("preserves the original error when ROLLBACK also fails", async () => {
    const original = new Error("callback boom");
    const rollbackError = new Error("rollback boom");
    const { client, calls } = createFakeClient({
      onQuery(text) {
        if (text === "ROLLBACK") {
          throw rollbackError;
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await assert.rejects(
      () =>
        runInTransaction(client, async () => {
          throw original;
        }),
      (error: unknown) => {
        assert.equal(error, original);
        return true;
      },
    );

    assert.deepEqual(
      calls.map((c) => c.text),
      ["BEGIN", "ROLLBACK"],
    );
  });

  it("preserves COMMIT error when subsequent ROLLBACK fails", async () => {
    const commitError = new Error("commit boom");
    const rollbackError = new Error("rollback boom");
    const { client } = createFakeClient({
      onQuery(text) {
        if (text === "COMMIT") {
          throw commitError;
        }
        if (text === "ROLLBACK") {
          throw rollbackError;
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await assert.rejects(
      () => runInTransaction(client, async () => "ok"),
      (error: unknown) => {
        assert.equal(error, commitError);
        return true;
      },
    );
  });

  it("applies only statement timeout when parallel gather is not disabled", async () => {
    const { client, calls } = createFakeClient();

    await runInTransaction(
      client,
      async () => null,
      { statementTimeoutMs: 250 },
    );

    assert.deepEqual(
      calls.map((c) => c.text),
      [
        "BEGIN",
        "SELECT set_config($1, $2, true)",
        "COMMIT",
      ],
    );
    assert.deepEqual(calls[1]?.values, ["statement_timeout", "250"]);
  });

  it("applies only max_parallel_workers_per_gather when timeout is unset", async () => {
    const { client, calls } = createFakeClient();

    await runInTransaction(
      client,
      async () => null,
      { disableParallelGather: true },
    );

    assert.deepEqual(
      calls.map((c) => c.text),
      [
        "BEGIN",
        "SELECT set_config($1, $2, true)",
        "COMMIT",
      ],
    );
    assert.deepEqual(calls[1]?.values, ["max_parallel_workers_per_gather", "0"]);
  });
});
