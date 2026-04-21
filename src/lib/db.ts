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
