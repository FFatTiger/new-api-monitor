import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __newApiMonitorPool: Pool | undefined;
}

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  return connectionString;
}

function getPool() {
  if (globalThis.__newApiMonitorPool) {
    return globalThis.__newApiMonitorPool;
  }

  const pool = new Pool({
    connectionString: getConnectionString(),
    max: 10,
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__newApiMonitorPool = pool;
  }

  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}

export async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export type DbClient = Pick<PoolClient, "query">;

export interface TransactionOptions {
  statementTimeoutMs?: number;
  disableParallelGather?: boolean;
  isolationLevel?: "read committed" | "repeatable read";
  readOnly?: boolean;
}

function buildBeginStatement(options?: TransactionOptions) {
  const parts = ["BEGIN"];

  if (options?.isolationLevel) {
    parts.push(`ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`);
  }

  if (options?.readOnly) {
    parts.push("READ ONLY");
  }

  return parts.join(" ");
}

export async function runInTransaction<T>(
  client: DbClient,
  callback: (client: DbClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  await client.query(buildBeginStatement(options));

  try {
    if (options?.statementTimeoutMs !== undefined) {
      await client.query("SELECT set_config($1, $2, true)", [
        "statement_timeout",
        String(options.statementTimeoutMs),
      ]);
    }

    if (options?.disableParallelGather) {
      await client.query("SELECT set_config($1, $2, true)", [
        "max_parallel_workers_per_gather",
        "0",
      ]);
    }

    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error if ROLLBACK also fails.
    }
    throw error;
  }
}

export async function withTransaction<T>(
  callback: (client: DbClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return withClient((client) => runInTransaction(client, callback, options));
}
