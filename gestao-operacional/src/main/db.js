'use strict';
/**
 * Banco de dados SQLite via libSQL.
 *  - Versão web/nuvem: banco remoto no Turso (url "libsql://..." + token) — os dados sobrevivem a
 *    reinícios do servidor (o disco do plano gratuito do Render é apagado a cada reinício).
 *  - Desktop / desenvolvimento: arquivo SQLite local ("file:caminho.sqlite").
 * Todas as operações são assíncronas.
 */
const { createClient } = require('@libsql/client');

const SCHEMA_VERSION = 2;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL CHECK (role IN ('gestor','planejador','operador')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tanks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    image_data TEXT,
    image_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS service_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    year INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','planejada','concluida')),
    type TEXT,
    description TEXT,
    tanks TEXT NOT NULL DEFAULT '[]',
    date TEXT,
    time TEXT,
    client TEXT,
    volume TEXT,
    product TEXT,
    team_planned TEXT,
    staff_planned INTEGER,
    executor TEXT,
    team_exec TEXT,
    staff_real INTEGER,
    start_at TEXT,
    end_at TEXT,
    hours_worked REAL,
    realized TEXT CHECK (realized IS NULL OR realized IN ('sim','nao','parcial')),
    area_ok INTEGER NOT NULL DEFAULT 0,
    occurrence TEXT,
    created_by INTEGER,
    updated_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_os_date ON service_orders(date)`,
  `CREATE INDEX IF NOT EXISTS idx_os_year ON service_orders(year, seq)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
];

/** Tabelas incluídas no backup (ordem de restauração). Sessões ficam de fora. */
const BACKUP_TABLES = ['users', 'tanks', 'clients', 'products', 'service_orders', 'settings'];

function toRows(rs) {
  return rs.rows.map((r) => {
    const o = {};
    rs.columns.forEach((c, i) => {
      const v = r[i];
      o[c] = typeof v === 'bigint' ? Number(v) : v;
    });
    return o;
  });
}

/** Interface comum ao banco e a uma transação aberta. */
class Executor {
  constructor(target) {
    this.target = target;
  }
  async all(sql, args = []) {
    return toRows(await this.target.execute({ sql, args }));
  }
  async get(sql, args = []) {
    return (await this.all(sql, args))[0] || null;
  }
  async run(sql, args = []) {
    const r = await this.target.execute({ sql, args });
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
  }
}

class Database extends Executor {
  constructor(client, url) {
    super(client);
    this.client = client;
    this.url = url;
  }

  /**
   * Abre o banco. `url`: "libsql://..." (Turso), "file:caminho" ou caminho de arquivo comum.
   */
  static async open(url, authToken) {
    if (!url) throw new Error('Informe o banco de dados (arquivo local ou URL do Turso).');
    const normalized = /^(libsql|https?|wss?|file):/.test(url) ? url : 'file:' + url;
    const client = createClient({ url: normalized, authToken: authToken || undefined, intMode: 'number' });
    const db = new Database(client, normalized);
    await db.migrate();
    return db;
  }

  async migrate() {
    for (const stmt of SCHEMA) await this.client.execute(stmt);
    await this.client.execute({
      sql: "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [String(SCHEMA_VERSION)],
    });
  }

  /** Executa `fn(tx)` em transação de escrita; desfaz tudo se `fn` lançar erro. */
  async transaction(fn) {
    const tx = await this.client.transaction('write');
    try {
      const r = await fn(new Executor(tx));
      await tx.commit();
      return r;
    } catch (e) {
      try {
        await tx.rollback();
      } catch (_) {
        /* ignora */
      }
      throw e;
    } finally {
      tx.close();
    }
  }

  /** Exporta todos os dados (exceto sessões) como objeto JSON. */
  async exportData() {
    const data = { format: 'gestao-operacional-backup', version: SCHEMA_VERSION, exported_at: new Date().toISOString(), tables: {} };
    for (const t of BACKUP_TABLES) data.tables[t] = await this.all(`SELECT * FROM ${t}`);
    return data;
  }

  /** Valida um backup (objeto JSON). Lança erro se não for compatível. */
  static validateBackup(data) {
    if (!data || data.format !== 'gestao-operacional-backup' || !data.tables) {
      throw new Error('Arquivo inválido: não é um backup do Gestão Operacional.');
    }
    if (data.version > SCHEMA_VERSION) throw new Error('Backup criado por uma versão mais nova do sistema.');
    for (const t of BACKUP_TABLES) {
      if (!Array.isArray(data.tables[t])) throw new Error('Backup incompleto (tabela ausente: ' + t + ').');
    }
    if (!data.tables.users.some((u) => u.role === 'gestor')) throw new Error('Backup sem usuário Gestor.');
  }

  /** Substitui todos os dados pelos do backup (já validado) e encerra todas as sessões. */
  async importData(data) {
    Database.validateBackup(data);
    const tx = await this.client.transaction('write');
    try {
      await tx.execute('DELETE FROM sessions');
      for (const t of [...BACKUP_TABLES].reverse()) await tx.execute(`DELETE FROM ${t}`);
      for (const t of BACKUP_TABLES) {
        for (const row of data.tables[t]) {
          const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
          if (!cols.length) continue;
          await tx.execute({
            sql: `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            args: cols.map((c) => row[c]),
          });
        }
      }
      await tx.commit();
    } catch (e) {
      try {
        await tx.rollback();
      } catch (_) {
        /* ignora */
      }
      throw new Error('Falha ao restaurar o backup: ' + e.message);
    } finally {
      tx.close();
    }
    await this.migrate();
  }

  close() {
    this.client.close();
  }
}

module.exports = { Database, SCHEMA_VERSION, BACKUP_TABLES };
