'use strict';
/**
 * Banco de dados local embutido (SQLite compilado para WebAssembly via sql.js).
 * Roda dentro do próprio processo da aplicação — sem servidor de banco separado
 * e sem módulos nativos — e é persistido em um único arquivo no disco.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('gestor','planejador','operador')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tanks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  image_data TEXT,
  image_name TEXT
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS service_orders (
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
);
CREATE INDEX IF NOT EXISTS idx_os_date ON service_orders(date);
CREATE INDEX IF NOT EXISTS idx_os_year ON service_orders(year, seq);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

let SQL = null;
async function loadSql() {
  if (!SQL) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
      .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
  }
  return SQL;
}

class Database {
  constructor(sqlDb, file) {
    this.db = sqlDb;
    this.file = file;
    this.inTx = false;
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  /** Abre (ou cria) o arquivo do banco. `file` = null cria um banco só em memória (testes). */
  static async open(file) {
    const S = await loadSql();
    let sqlDb;
    if (file && fs.existsSync(file)) {
      sqlDb = new S.Database(fs.readFileSync(file));
    } else {
      sqlDb = new S.Database();
    }
    const d = new Database(sqlDb, file);
    d.migrate();
    return d;
  }

  /** Valida se um buffer é um backup compatível deste sistema. Lança erro se não for. */
  static async validateBackup(buffer) {
    const S = await loadSql();
    let test;
    try {
      test = new S.Database(buffer);
      const tables = test.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const names = new Set((tables[0] ? tables[0].values : []).map((r) => r[0]));
      for (const t of ['users', 'tanks', 'clients', 'products', 'service_orders', 'settings']) {
        if (!names.has(t)) throw new Error('Arquivo não é um backup válido do sistema (tabela ausente: ' + t + ').');
      }
      const v = test.exec('PRAGMA user_version')[0].values[0][0];
      if (v > SCHEMA_VERSION) throw new Error('Backup criado por uma versão mais nova do sistema.');
    } catch (e) {
      if (/backup/i.test(e.message)) throw e;
      throw new Error('Arquivo inválido: não é um banco de dados do sistema.');
    } finally {
      if (test) test.close();
    }
  }

  migrate() {
    const v = this.get('PRAGMA user_version');
    const current = v ? Object.values(v)[0] : 0;
    if (current < SCHEMA_VERSION) {
      this.db.exec(SCHEMA);
      this.db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.save();
    }
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    const changes = this.db.getRowsModified();
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    if (!this.inTx) this.save();
    return { lastInsertRowid: id, changes };
  }

  /** Executa `fn` em transação; grava no disco uma única vez ao final. */
  transaction(fn) {
    if (this.inTx) return fn();
    this.db.run('BEGIN');
    this.inTx = true;
    try {
      const r = fn();
      this.db.run('COMMIT');
      this.inTx = false;
      this.save();
      return r;
    } catch (e) {
      this.inTx = false;
      try { this.db.run('ROLLBACK'); } catch (_) { /* ignora */ }
      throw e;
    }
  }

  export() {
    const data = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON;');
    return Buffer.from(data);
  }

  /** Grava o banco no disco de forma atômica (arquivo temporário + rename). */
  save() {
    if (!this.file) return;
    const data = this.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file);
  }

  /** Substitui todo o conteúdo pelo de um backup (já validado). */
  async replaceWith(buffer) {
    const S = await loadSql();
    this.db.close();
    this.db = new S.Database(buffer);
    this.db.run('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.save();
  }

  close() {
    this.db.close();
  }
}

module.exports = { Database, SCHEMA_VERSION };
