import { Pool, type PoolClient, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable");
}

declare global {
  var __newApiMonitorPool: Pool | undefined;
}

export const pool =
  globalThis.__newApiMonitorPool ??
  new Pool({
    connectionString,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__newApiMonitorPool = pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return pool.query<T>(text, values);
}

export async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}
