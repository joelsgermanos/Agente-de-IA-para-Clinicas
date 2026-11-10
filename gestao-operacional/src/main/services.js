'use strict';
/**
 * Regras de negócio do sistema (assíncronas). Independem do transporte: são usadas pelo servidor web
 * (uma instância por requisição, com o usuário da sessão), pelo app desktop e pelos testes.
 */
const crypto = require('crypto');
const { hashPassword, verifyPassword, validatePasswordStrength } = require('./auth');
const D = require('./domain');

const ROLES = { gestor: 'Gestor', planejador: 'Planejador', operador: 'Operador' };
const MAX_IMAGE_CHARS = 20 * 1024 * 1024; // ~15 MB de imagem em base64
const SESSION_DAYS = 7;

const SEED = {
  tanks: ['TQ-282001', 'TQ-282002', 'TQ-282003', 'TQ-282004', 'TQ-282005', 'TQ-282006', 'TQ-282007', 'TQ-282008'],
  clients: ['Cliente Exemplo 1', 'Cliente Exemplo 2'],
  products: ['Diesel S10', 'Diesel S500', 'Gasolina A', 'Etanol Anidro', 'Etanol Hidratado', 'Biodiesel B100', 'Óleo Vegetal', 'Soda Cáustica'],
};

class AppError extends Error {
  constructor(message, code = 'ERRO') {
    super(message);
    this.code = code;
    this.userFacing = true;
  }
}

function str(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function int(v, label) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new AppError(`${label} deve ser um número inteiro (0 ou maior).`);
  return n;
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(D.parseDate(s));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s || '') && isDate(s.slice(0, 10));
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function checkPassword(p) {
  try {
    validatePasswordStrength(p);
  } catch (e) {
    throw new AppError(e.message);
  }
}

class Services {
  /** `userId`: usuário da sessão atual (ou null). */
  constructor(db, { now = () => new Date(), userId = null } = {}) {
    this.db = db;
    this.now = now;
    this.user = userId ? { id: userId } : null;
  }

  // ------------------------------------------------------------------ sessões (versão web)
  /** Cria uma sessão e devolve o token (só o hash fica gravado no banco). */
  async sessionCreate(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = Date.now();
    await this.db.run('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)', [
      sha256(token),
      userId,
      t + SESSION_DAYS * 86400000,
      t,
    ]);
    await this.db.run('DELETE FROM sessions WHERE expires_at < ?', [t]);
    return { token, maxAge: SESSION_DAYS * 86400 };
  }

  /** Resolve o token do cookie para o id do usuário (renova a validade a cada hora de uso). */
  async sessionResolve(token) {
    if (!token) return null;
    const s = await this.db.get('SELECT * FROM sessions WHERE token_hash = ?', [sha256(token)]);
    const t = Date.now();
    if (!s || s.expires_at < t) return null;
    if (s.expires_at - t < SESSION_DAYS * 86400000 - 3600000) {
      await this.db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', [t + SESSION_DAYS * 86400000, s.token_hash]);
    }
    return s.user_id;
  }

  async sessionDestroy(token) {
    if (token) await this.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  }

  // ------------------------------------------------------------------ autenticação / permissões
  async requireUser() {
    if (!this.user) throw new AppError('Sessão expirada. Faça login novamente.', 'AUTH');
    const u = await this.db.get('SELECT id, username, name, email, role FROM users WHERE id = ?', [this.user.id]);
    if (!u) {
      this.user = null;
      throw new AppError('Usuário não encontrado. Faça login novamente.', 'AUTH');
    }
    this.user = u;
    return u;
  }
  async requireRole(...roles) {
    const u = await this.requireUser();
    if (!roles.includes(u.role)) throw new AppError('Seu perfil não tem permissão para esta ação.', 'PERM');
    return u;
  }

  async meta() {
    return {
      types: D.OPERATION_TYPES,
      blocks: D.BLOCKS,
      teams: D.TEAMS,
      statuses: D.STATUSES,
      realized: D.REALIZED,
      roles: ROLES,
      logo: await this.getSetting('logo'),
    };
  }

  async authStatus() {
    const { n } = await this.db.get('SELECT COUNT(*) AS n FROM users');
    let user = null;
    if (this.user) {
      try {
        user = await this.requireUser();
      } catch (_) {
        user = null;
      }
    }
    return { needsSetup: n === 0, user };
  }

  /** Primeira execução: cria a conta do Gestor e os cadastros iniciais. */
  async setup({ name, username, password, email } = {}) {
    if ((await this.db.get('SELECT COUNT(*) AS n FROM users')).n > 0) throw new AppError('O sistema já foi configurado.');
    const u = await this._createUser({ name, username, password, email, role: 'gestor' });
    await this.db.transaction((tx) => this._seedCadastros(tx));
    this.user = u;
    return this.authStatus();
  }

  async login({ username, password } = {}) {
    const row = await this.db.get('SELECT * FROM users WHERE username = ?', [str(username, 100) || '']);
    if (!row || !verifyPassword(password || '', row.password_hash, row.password_salt)) {
      throw new AppError('Usuário ou senha inválidos.', 'AUTH');
    }
    this.user = { id: row.id };
    return this.authStatus();
  }

  async logout() {
    this.user = null;
    return { ok: true };
  }

  async changePassword({ current, next } = {}) {
    const u = await this.requireUser();
    const row = await this.db.get('SELECT * FROM users WHERE id = ?', [u.id]);
    if (!verifyPassword(current || '', row.password_hash, row.password_salt)) throw new AppError('Senha atual incorreta.');
    checkPassword(next);
    const { hash, salt } = hashPassword(next);
    await this.db.run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, u.id]);
    return { ok: true };
  }

  // ------------------------------------------------------------------ usuários (Logins)
  async _createUser({ name, username, password, email, role }) {
    name = str(name, 120);
    username = str(username, 60);
    email = str(email, 160);
    if (!name) throw new AppError('Informe o nome.');
    if (!username || !/^[A-Za-z0-9._-]{3,60}$/.test(username)) {
      throw new AppError('Usuário deve ter 3+ caracteres (letras, números, ponto, hífen ou sublinhado).');
    }
    if (email && !isEmail(email)) throw new AppError('E-mail inválido.');
    if (!ROLES[role]) throw new AppError('Perfil inválido.');
    checkPassword(password);
    if (await this.db.get('SELECT id FROM users WHERE username = ?', [username])) throw new AppError('Já existe um usuário com esse login.');
    const { hash, salt } = hashPassword(password);
    const r = await this.db.run(
      'INSERT INTO users (username, name, email, role, password_hash, password_salt, created_at) VALUES (?,?,?,?,?,?,?)',
      [username, name, email, role, hash, salt, nowIso()]
    );
    return this.db.get('SELECT id, username, name, email, role FROM users WHERE id = ?', [r.lastInsertRowid]);
  }

  async usersList() {
    await this.requireRole('gestor');
    return this.db.all(
      "SELECT id, username, name, email, role FROM users ORDER BY CASE role WHEN 'gestor' THEN 0 WHEN 'planejador' THEN 1 ELSE 2 END, name"
    );
  }

  async usersAdd(data = {}) {
    await this.requireRole('gestor');
    if (!['planejador', 'operador'].includes(data.role)) throw new AppError('Por esta tela só é possível criar perfis Planejador ou Operador.');
    return this._createUser(data);
  }

  async usersUpdate({ id, name, email, role, password } = {}) {
    const me = await this.requireRole('gestor');
    const row = await this.db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new AppError('Usuário não encontrado.');
    name = str(name, 120);
    email = str(email, 160);
    if (!name) throw new AppError('Informe o nome.');
    if (email && !isEmail(email)) throw new AppError('E-mail inválido.');
    let newRole = row.role;
    if (row.role !== 'gestor') {
      if (!['planejador', 'operador'].includes(role)) throw new AppError('Perfil inválido.');
      newRole = role;
    }
    if (password) checkPassword(password);
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?', [name, email, newRole, id]);
      if (password) {
        const { hash, salt } = hashPassword(password);
        await tx.run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, id]);
        // senha redefinida pelo Gestor: encerra as sessões abertas desse usuário
        if (id !== me.id) await tx.run('DELETE FROM sessions WHERE user_id = ?', [id]);
      }
    });
    return { ok: true };
  }

  async usersRemove(id) {
    const me = await this.requireRole('gestor');
    const row = await this.db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) throw new AppError('Usuário não encontrado.');
    if (row.id === me.id) throw new AppError('Você não pode remover o próprio acesso.');
    if (row.role === 'gestor') throw new AppError('O acesso de Gestor não pode ser removido por esta tela.');
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM sessions WHERE user_id = ?', [id]);
      await tx.run('DELETE FROM users WHERE id = ?', [id]);
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ cadastros
  async _seedCadastros(tx) {
    for (const c of SEED.tanks) await tx.run('INSERT OR IGNORE INTO tanks (code) VALUES (?)', [c]);
    for (const c of SEED.clients) await tx.run('INSERT OR IGNORE INTO clients (name) VALUES (?)', [c]);
    for (const c of SEED.products) await tx.run('INSERT OR IGNORE INTO products (name) VALUES (?)', [c]);
  }

  async lookups() {
    await this.requireUser();
    return {
      tanks: await this.db.all(
        "SELECT id, code, image_name, (image_data IS NOT NULL AND image_data <> '') AS has_image FROM tanks ORDER BY code"
      ),
      clients: await this.db.all('SELECT id, name FROM clients ORDER BY name'),
      products: await this.db.all('SELECT id, name FROM products ORDER BY name'),
    };
  }

  async tankImage(code) {
    await this.requireUser();
    const t = await this.db.get('SELECT code, image_data, image_name FROM tanks WHERE code = ?', [code]);
    return t && t.image_data ? t : null;
  }

  async tankAdd(code) {
    await this.requireRole('gestor');
    code = (str(code, 40) || '').toUpperCase();
    if (!code) throw new AppError('Informe o código do tanque.');
    if (await this.db.get('SELECT id FROM tanks WHERE code = ?', [code])) throw new AppError('Tanque já cadastrado.');
    await this.db.run('INSERT INTO tanks (code) VALUES (?)', [code]);
    return { ok: true };
  }

  /** Renomeia o código do tanque e migra as O.S. que o referenciam. */
  async tankRename(id, code) {
    await this.requireRole('gestor');
    code = (str(code, 40) || '').toUpperCase();
    if (!code) throw new AppError('Informe o código do tanque.');
    const t = await this.db.get('SELECT * FROM tanks WHERE id = ?', [id]);
    if (!t) throw new AppError('Tanque não encontrado.');
    if (t.code === code) return { ok: true, migrated: 0 };
    if (await this.db.get('SELECT id FROM tanks WHERE code = ? AND id <> ?', [code, id])) throw new AppError('Já existe um tanque com esse código.');
    return this.db.transaction(async (tx) => {
      let migrated = 0;
      await tx.run('UPDATE tanks SET code = ? WHERE id = ?', [code, id]);
      for (const o of await tx.all('SELECT id, tanks FROM service_orders WHERE instr(tanks, ?) > 0', [t.code])) {
        const list = JSON.parse(o.tanks || '[]');
        if (list.includes(t.code)) {
          await tx.run('UPDATE service_orders SET tanks = ? WHERE id = ?', [JSON.stringify(list.map((c) => (c === t.code ? code : c))), o.id]);
          migrated++;
        }
      }
      return { ok: true, migrated };
    });
  }

  async tankRemove(id) {
    await this.requireRole('gestor');
    await this.db.run('DELETE FROM tanks WHERE id = ?', [id]);
    return { ok: true };
  }

  async tankSetImage(id, dataUrl, name) {
    await this.requireRole('gestor');
    if (dataUrl) {
      if (!/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/.test(dataUrl)) {
        throw new AppError('Formato de imagem não suportado (use PNG, JPG, GIF, WEBP, BMP ou SVG).');
      }
      if (dataUrl.length > MAX_IMAGE_CHARS) throw new AppError('Imagem muito grande (máx. ~15 MB).');
    }
    const r = await this.db.run('UPDATE tanks SET image_data = ?, image_name = ? WHERE id = ?', [dataUrl || null, dataUrl ? str(name, 200) : null, id]);
    if (!r.changes) throw new AppError('Tanque não encontrado.');
    return { ok: true };
  }

  _refTable(kind) {
    if (kind === 'clients') return { table: 'clients', col: 'client', label: 'cliente' };
    if (kind === 'products') return { table: 'products', col: 'product', label: 'produto' };
    throw new AppError('Cadastro inválido.');
  }

  async refAdd(kind, name) {
    await this.requireRole('gestor');
    const { table, label } = this._refTable(kind);
    name = str(name, 120);
    if (!name) throw new AppError(`Informe o nome do ${label}.`);
    if (await this.db.get(`SELECT id FROM ${table} WHERE name = ?`, [name])) throw new AppError(`Esse ${label} já está cadastrado.`);
    await this.db.run(`INSERT INTO ${table} (name) VALUES (?)`, [name]);
    return { ok: true };
  }

  /** Renomeia cliente/produto e migra as O.S. existentes para o novo nome. */
  async refRename(kind, id, name) {
    await this.requireRole('gestor');
    const { table, col, label } = this._refTable(kind);
    name = str(name, 120);
    if (!name) throw new AppError(`Informe o nome do ${label}.`);
    const row = await this.db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw new AppError('Registro não encontrado.');
    if (await this.db.get(`SELECT id FROM ${table} WHERE name = ? AND id <> ?`, [name, id])) throw new AppError(`Já existe um ${label} com esse nome.`);
    return this.db.transaction(async (tx) => {
      await tx.run(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, id]);
      const migrated = (await tx.run(`UPDATE service_orders SET ${col} = ? WHERE ${col} = ?`, [name, row.name])).changes;
      return { ok: true, migrated };
    });
  }

  async refRemove(kind, id) {
    await this.requireRole('gestor');
    const { table } = this._refTable(kind);
    await this.db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return { ok: true };
  }

  // ------------------------------------------------------------------ configurações
  async getSetting(key) {
    const r = await this.db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return r ? r.value : null;
  }
  async setSetting(key, value) {
    await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  async getScale() {
    const raw = await this.getSetting('scale');
    if (!raw) return { ...D.DEFAULT_SCALE };
    try {
      const s = JSON.parse(raw);
      return { anchor: s.anchor, order: s.order };
    } catch (_) {
      return { ...D.DEFAULT_SCALE };
    }
  }

  async scaleGet({ from, days = 16 } = {}) {
    await this.requireUser();
    const scale = await this.getScale();
    const start = isDate(from) ? from : this.today();
    const preview = [];
    for (let i = 0; i < Math.min(Number(days) || 16, 62); i++) {
      const date = D.addDays(start, i);
      preview.push({ date, ...D.shiftsOnDate(date, scale) });
    }
    return { scale, preview };
  }

  async scaleSet({ anchor, order } = {}) {
    await this.requireRole('gestor');
    if (!isDate(anchor)) throw new AppError('Data âncora inválida.');
    if (!Array.isArray(order) || order.length !== 4 || [...order].sort().join('') !== 'ABCD') {
      throw new AppError('A ordem deve conter cada equipe (A, B, C, D) exatamente uma vez.');
    }
    await this.setSetting('scale', JSON.stringify({ anchor, order }));
    return { ok: true };
  }

  async logoSet(dataUrl) {
    await this.requireRole('gestor');
    if (dataUrl && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(dataUrl)) throw new AppError('Formato de imagem não suportado.');
    if (dataUrl && dataUrl.length > 5 * 1024 * 1024) throw new AppError('Logo muito grande (máx. ~3,5 MB).');
    await this.setSetting('logo', dataUrl || null);
    return { ok: true };
  }

  /** "Limpar dados": apaga O.S. e cadastros, restaurando o estado inicial. Mantém usuários e configurações. */
  async resetData() {
    await this.requireRole('gestor');
    await this.db.transaction(async (tx) => {
      for (const t of ['service_orders', 'tanks', 'clients', 'products']) await tx.run(`DELETE FROM ${t}`);
      await this._seedCadastros(tx);
    });
    return { ok: true };
  }

  async backupExport() {
    await this.requireRole('gestor');
    return this.db.exportData();
  }

  async backupImport(data) {
    await this.requireRole('gestor');
    try {
      await this.db.importData(data);
    } catch (e) {
      throw new AppError(e.message);
    }
    this.user = null;
    return { restored: true };
  }

  // ------------------------------------------------------------------ Ordens de Serviço
  today() {
    const n = this.now();
    const p = (x) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  }

  _row(o) {
    if (!o) return null;
    const type = D.typeById(o.type);
    return {
      ...o,
      tanks: JSON.parse(o.tanks || '[]'),
      area_ok: !!o.area_ok,
      type_label: type ? type.label : null,
      block: type ? type.block : null,
    };
  }

  async osList() {
    const u = await this.requireUser();
    const where = u.role === 'operador' ? "WHERE status <> 'rascunho'" : '';
    const rows = await this.db.all(
      `SELECT id, number, status, type, description, date, time, client, product, tanks, team_planned, team_exec, realized
       FROM service_orders ${where} ORDER BY year DESC, seq DESC`
    );
    return rows.map((o) => this._row(o));
  }

  async _getOs(id) {
    const o = await this.db.get('SELECT * FROM service_orders WHERE id = ?', [id]);
    if (!o) throw new AppError('O.S. não encontrada.');
    return o;
  }

  async osGet(id) {
    const u = await this.requireUser();
    const o = this._row(await this._getOs(id));
    if (u.role === 'operador' && o.status === 'rascunho') throw new AppError('O.S. não encontrada.');
    const names = await this.db.all('SELECT id, name FROM users WHERE id IN (?, ?)', [o.created_by || 0, o.updated_by || 0]);
    o.created_by_name = (names.find((n) => n.id === o.created_by) || {}).name || null;
    o.updated_by_name = (names.find((n) => n.id === o.updated_by) || {}).name || null;
    const type = D.typeById(o.type);
    o.tank_images = [];
    if (type && type.image) {
      for (const code of o.tanks) {
        const t = await this.db.get('SELECT code, image_data, image_name FROM tanks WHERE code = ?', [code]);
        if (t && t.image_data) o.tank_images.push(t);
      }
    }
    return o;
  }

  /** "+ Nova O.S.": cria um rascunho com numeração automática AAAA-NNNN (atômica, segura com vários usuários). */
  async osCreate() {
    const u = await this.requireRole('gestor', 'planejador');
    const year = this.now().getFullYear();
    const ts = nowIso();
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await this.db.run(
          `INSERT INTO service_orders (number, year, seq, status, date, created_by, updated_by, created_at, updated_at)
           SELECT printf('%d-%04d', ?1, COALESCE(MAX(seq), 0) + 1), ?1, COALESCE(MAX(seq), 0) + 1, 'rascunho', ?2, ?3, ?3, ?4, ?4
           FROM service_orders WHERE year = ?1`,
          [year, this.today(), u.id, ts]
        );
        return this.osGet(r.lastInsertRowid);
      } catch (e) {
        lastErr = e;
        if (!/UNIQUE/i.test(e.message)) throw e;
      }
    }
    throw lastErr;
  }

  /** Salva a aba Agendamento. `plan: true` libera a O.S. (Rascunho → Planejada). */
  async osSaveAgendamento(id, data = {}, { plan = false } = {}) {
    const u = await this.requireRole('gestor', 'planejador');
    const o = await this._getOs(id);
    if (o.status === 'concluida') throw new AppError('O.S. concluída. Reabra a O.S. para alterar o agendamento.');

    const type = data.type ? D.typeById(data.type) : null;
    if (data.type && !type) throw new AppError('Tipo de operação inválido.');
    let tanks = Array.isArray(data.tanks) ? [...new Set(data.tanks.map((t) => String(t)))] : [];
    if (!type || !type.tanks) tanks = [];
    for (const code of tanks) {
      if (!(await this.db.get('SELECT id FROM tanks WHERE code = ?', [code]))) throw new AppError(`Tanque ${code} não está cadastrado.`);
    }
    const v = {
      type: type ? type.id : null,
      description: str(data.description, 4000),
      tanks: JSON.stringify(tanks),
      date: str(data.date, 10),
      time: str(data.time, 5),
      client: type && type.id === 'maritima' ? str(data.client, 120) : null,
      volume: type && type.id === 'maritima' ? str(data.volume, 60) : null,
      product: str(data.product, 120),
      team_planned: D.TEAMS.includes(data.team_planned) ? data.team_planned : null,
      staff_planned: int(data.staff_planned, 'Efetivo de operadores programados'),
    };
    if (v.date && !isDate(v.date)) throw new AppError('Data inválida.');
    if (v.time && !isTime(v.time)) throw new AppError('Hora inválida.');

    const willBePlanned = plan || o.status === 'planejada';
    if (willBePlanned) {
      const missing = [];
      if (!v.type) missing.push('Tipo de operação');
      if (!v.description) missing.push('Descrição da atividade');
      if (!v.date) missing.push('Data');
      if (!v.time) missing.push('Hora');
      if (missing.length) throw new AppError('Preencha os campos obrigatórios: ' + missing.join(', ') + '.');
    }
    await this.db.run(
      `UPDATE service_orders SET type=?, description=?, tanks=?, date=?, time=?, client=?, volume=?, product=?,
       team_planned=?, staff_planned=?, status=?, updated_by=?, updated_at=? WHERE id=?`,
      [v.type, v.description, v.tanks, v.date, v.time, v.client, v.volume, v.product, v.team_planned, v.staff_planned,
        willBePlanned ? 'planejada' : 'rascunho', u.id, nowIso(), id]
    );
    return this.osGet(id);
  }

  /** Salva a aba Final. `conclude: true` valida os dados de execução e muda para Concluída. */
  async osSaveFinal(id, data = {}, { conclude = false } = {}) {
    const u = await this.requireUser();
    const o = await this._getOs(id);
    if (o.status === 'rascunho') throw new AppError('A aba Final só é liberada após o planejamento da O.S.');
    if (o.status === 'concluida') throw new AppError('O.S. já concluída. Reabra a O.S. para alterar os dados de execução.');

    const v = {
      executor: str(data.executor, 120),
      team_exec: D.TEAMS.includes(data.team_exec) ? data.team_exec : null,
      staff_real: int(data.staff_real, 'Efetivo de operadores real'),
      start_at: str(data.start_at, 16),
      end_at: str(data.end_at, 16),
      realized: D.REALIZED[data.realized] ? data.realized : null,
      area_ok: data.area_ok ? 1 : 0,
      occurrence: str(data.occurrence, 4000),
    };
    if (v.start_at && !isDateTime(v.start_at)) throw new AppError('Início da atividade inválido (informe data e hora).');
    if (v.end_at && !isDateTime(v.end_at)) throw new AppError('Final da atividade inválido (informe data e hora).');
    let hours = null;
    if (v.start_at && v.end_at) {
      hours = D.hoursBetween(v.start_at, v.end_at);
      if (hours <= 0) throw new AppError('O final da atividade deve ser posterior ao início. Corrija as datas/horas antes de salvar.');
    }
    if (conclude) {
      const missing = [];
      if (!v.staff_real) missing.push('Efetivo de operadores real (maior que zero)');
      if (!v.start_at) missing.push('Início da atividade (data e hora)');
      if (!v.end_at) missing.push('Final da atividade (data e hora)');
      if (!v.realized) missing.push('Atividade foi realizada?');
      if ((v.realized === 'nao' || v.realized === 'parcial') && !v.occurrence) missing.push('Detalhe da ocorrência');
      if (missing.length) throw new AppError('Para concluir a O.S., preencha: ' + missing.join('; ') + '.');
    }
    await this.db.run(
      `UPDATE service_orders SET executor=?, team_exec=?, staff_real=?, start_at=?, end_at=?, hours_worked=?, realized=?,
       area_ok=?, occurrence=?, status=?, updated_by=?, updated_at=? WHERE id=?`,
      [v.executor, v.team_exec, v.staff_real, v.start_at, v.end_at, hours, v.realized, v.area_ok, v.occurrence,
        conclude ? 'concluida' : o.status, u.id, nowIso(), id]
    );
    return this.osGet(id);
  }

  async osReopen(id) {
    const u = await this.requireRole('gestor', 'planejador');
    const o = await this._getOs(id);
    if (o.status !== 'concluida') throw new AppError('Somente O.S. concluídas podem ser reabertas.');
    await this.db.run("UPDATE service_orders SET status='planejada', updated_by=?, updated_at=? WHERE id=?", [u.id, nowIso(), id]);
    return this.osGet(id);
  }

  /** Exclusão física (sem soft delete). A confirmação é feita pela interface. */
  async osDelete(id) {
    await this.requireRole('gestor', 'planejador');
    await this._getOs(id);
    await this.db.run('DELETE FROM service_orders WHERE id = ?', [id]);
    return { ok: true };
  }

  // ------------------------------------------------------------------ Programação diária / Dashboard
  async programacao(date) {
    const u = await this.requireUser();
    if (!isDate(date)) throw new AppError('Data inválida.');
    const orders = (
      await this.db.all(
        "SELECT id, number, status, type, description, date, time, client, product, tanks, realized FROM service_orders WHERE date = ? AND status <> 'rascunho' ORDER BY time, seq",
        [date]
      )
    ).map((o) => this._row(o));
    return {
      date,
      elaboratedBy: u.name,
      shifts: D.shiftsOnDate(date, await this.getScale()),
      blocks: D.BLOCKS.map((b) => ({ ...b, orders: orders.filter((o) => o.block === b.id) })),
      total: orders.length,
    };
  }

  async dashboard({ from, to } = {}) {
    await this.requireRole('gestor', 'planejador');
    const orders = await this.db.all("SELECT * FROM service_orders WHERE status <> 'rascunho' AND date BETWEEN ? AND ?", [from || '', to || '']);
    try {
      return D.computeDashboard(orders, from, to, await this.getScale());
    } catch (e) {
      throw new AppError(e.message);
    }
  }
}

module.exports = { Services, AppError, ROLES, SEED };
