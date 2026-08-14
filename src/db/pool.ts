import { Pool, type PoolClient } from "pg";
import { env } from "../config/env";
import { childLogger } from "../config/logger";

const log = childLogger("db");

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.PGSSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on("error", (err) => {
  log.error({ err }, "erro inesperado no pool do postgres");
});

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
