import fs from "node:fs";
import path from "node:path";
import { pool } from "../src/db/pool";
import { childLogger } from "../src/config/logger";

const log = childLogger("migrate");
const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "db", "migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function listUpMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();
}

async function up() {
  await ensureMigrationsTable();
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  const pending = listUpMigrations().filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log.info("nenhuma migration pendente");
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    log.info({ file }, "aplicando migration");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  log.info({ count: pending.length }, "migrations aplicadas com sucesso");
}

async function down() {
  await ensureMigrationsTable();
  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"
  );
  if (rows.length === 0) {
    log.info("nenhuma migration aplicada para reverter");
    return;
  }

  const last = rows[0].name;
  const downFile = last.replace(/\.sql$/, ".down.sql");
  const downPath = path.join(MIGRATIONS_DIR, downFile);

  if (!fs.existsSync(downPath)) {
    throw new Error(`arquivo de rollback nao encontrado: ${downFile}`);
  }

  const sql = fs.readFileSync(downPath, "utf-8");
  log.info({ file: downFile }, "revertendo migration");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE name = $1", [last]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const direction = process.argv[2] === "down" ? "down" : "up";
  if (direction === "down") {
    await down();
  } else {
    await up();
  }
  await pool.end();
}

main().catch((err) => {
  log.error({ err }, "falha ao rodar migrations");
  process.exit(1);
});
