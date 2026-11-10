'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../src/main/db');
const { Services } = require('../src/main/services');
const { dispatch } = require('../src/main/router');
const D = require('../src/main/domain');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestao-test-'));
let n = 0;
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

async function fresh(now = new Date('2026-11-10T10:00:00')) {
  const db = await Database.open(path.join(tmpDir, `db-${n++}.sqlite`));
  const s = new Services(db, { now: () => now });
  await s.setup({ name: 'Gestora Teste', username: 'gestor', password: 'segredo1' });
  return { db, s };
}

async function planned(s, data = {}) {
  const o = await s.osCreate();
  return s.osSaveAgendamento(o.id, { type: 'manutencao', description: 'Apoio', date: '2026-11-10', time: '08:00', ...data }, { plan: true });
}

test('escala: todo dia exatamente 1 equipe no diurno, 1 no noturno e 2 de folga', () => {
  for (let i = 0; i < 400; i++) {
    const day = D.addDays('2026-01-01', i - 200);
    const sh = D.shiftsOnDate(day);
    assert.ok(sh.D && sh.N, day);
    assert.notEqual(sh.D, sh.N);
    assert.equal(sh.F.length, 2);
  }
  const seq = Array.from({ length: 16 }, (_, i) => D.teamShift('A', D.addDays('2026-01-01', i))).join('');
  assert.equal(seq, 'DDDDNNNNFFFFFFFF');
});

test('setup cria Gestor com senha em hash e login exige senha correta', async () => {
  const { db, s } = await fresh();
  const row = await db.get('SELECT * FROM users WHERE username = ?', ['gestor']);
  assert.notEqual(row.password_hash, 'segredo1');
  assert.ok(row.password_salt);
  await s.logout();
  await assert.rejects(s.login({ username: 'gestor', password: 'errada' }), /inválidos/);
  assert.equal((await s.login({ username: 'GESTOR', password: 'segredo1' })).user.role, 'gestor');
  await assert.rejects(s.setup({ name: 'x', username: 'outro', password: '123456' }), /já foi configurado/);
});

test('sessões: token resolve o usuário, não é gravado em texto puro e é invalidado', async () => {
  const { db, s } = await fresh();
  const { token } = await s.sessionCreate(s.user.id);
  assert.equal(await s.sessionResolve(token), s.user.id);
  assert.equal(await db.get('SELECT * FROM sessions WHERE token_hash = ?', [token]), null);
  assert.equal(await s.sessionResolve('token-falso'), null);
  await s.sessionDestroy(token);
  assert.equal(await s.sessionResolve(token), null);
  // remover um usuário encerra as sessões dele
  const op = await s.usersAdd({ name: 'Op', username: 'oper', password: '123456', role: 'operador' });
  const t2 = (await s.sessionCreate(op.id)).token;
  await s.usersRemove(op.id);
  assert.equal(await s.sessionResolve(t2), null);
});

test('Logins: só cria Planejador/Operador; Gestor não é removível', async () => {
  const { s } = await fresh();
  await assert.rejects(s.usersAdd({ name: 'G2', username: 'g2x', password: '123456', role: 'gestor' }), /Planejador ou Operador/);
  const op = await s.usersAdd({ name: 'Op', username: 'op1', password: '123456', role: 'operador' });
  assert.equal(op.role, 'operador');
  await assert.rejects(s.usersAdd({ name: 'Op', username: 'op1', password: '123456', role: 'operador' }), /Já existe/);
  await assert.rejects(s.usersRemove(s.user.id), /próprio/);
});

test('numeração AAAA-NNNN a partir do maior número do ano corrente (inclusive em paralelo)', async () => {
  const { s } = await fresh();
  const a = await s.osCreate();
  const b = await s.osCreate();
  assert.equal(a.number, '2026-0001');
  assert.equal(b.number, '2026-0002');
  await s.osDelete(a.id);
  assert.equal((await s.osCreate()).number, '2026-0003');
  const many = await Promise.all(Array.from({ length: 5 }, () => s.osCreate()));
  assert.equal(new Set(many.map((o) => o.number)).size, 5);
  s.now = () => new Date('2027-01-02T10:00:00');
  assert.equal((await s.osCreate()).number, '2027-0001');
});

test('planejamento exige campos obrigatórios; tanques só para tipos com tanque; cliente só marítima', async () => {
  const { s } = await fresh();
  const o = await s.osCreate();
  await assert.rejects(s.osSaveAgendamento(o.id, { type: 'maritima' }, { plan: true }), /Descrição.*Data.*Hora/);
  const draft = await s.osSaveAgendamento(o.id, { type: 'manutencao', tanks: ['TQ-282001'], client: 'Cliente Exemplo 1' });
  assert.equal(draft.status, 'rascunho');
  assert.deepEqual(draft.tanks, []);
  assert.equal(draft.client, null);
  const p = await s.osSaveAgendamento(
    o.id,
    { type: 'maritima', description: 'Descarga navio', date: '2026-11-10', time: '07:00', tanks: ['TQ-282001'], client: 'Cliente Exemplo 1', volume: '5000 m3' },
    { plan: true }
  );
  assert.equal(p.status, 'planejada');
  assert.deepEqual(p.tanks, ['TQ-282001']);
  assert.equal(p.block, 'aquaviarias');
  await assert.rejects(s.osSaveAgendamento(o.id, { type: 'maritima', description: 'x', date: '2026-11-10', time: '07:00', tanks: ['TQ-999'] }), /não está cadastrado/);
});

test('aba Final: bloqueada em rascunho, exige dados de execução e final após início', async () => {
  const { s } = await fresh();
  const d = await s.osCreate();
  await assert.rejects(s.osSaveFinal(d.id, {}, { conclude: true }), /só é liberada/);
  const o = await planned(s);
  await assert.rejects(s.osSaveFinal(o.id, { realized: 'sim' }, { conclude: true }), /Efetivo.*Início.*Final/);
  await assert.rejects(
    s.osSaveFinal(o.id, { staff_real: 3, start_at: '2026-11-10T10:00', end_at: '2026-11-10T09:00', realized: 'sim' }, { conclude: true }),
    /posterior ao início/
  );
  await assert.rejects(
    s.osSaveFinal(o.id, { staff_real: 3, start_at: '2026-11-10T08:00', end_at: '2026-11-10T12:00', realized: 'parcial' }, { conclude: true }),
    /Detalhe da ocorrência/
  );
  const c = await s.osSaveFinal(o.id, { staff_real: 3, start_at: '2026-11-10T20:00', end_at: '2026-11-11T02:30', realized: 'parcial', occurrence: 'Chuva' }, { conclude: true });
  assert.equal(c.status, 'concluida');
  assert.equal(c.hours_worked, 6.5);
  await assert.rejects(s.osSaveFinal(o.id, {}), /Reabra/);
  assert.equal((await s.osReopen(o.id)).status, 'planejada');
});

test('Operador: não vê rascunhos, não cria nem exclui, mas preenche a Final', async () => {
  const { db, s } = await fresh();
  const op = await s.usersAdd({ name: 'Op', username: 'oper', password: '123456', role: 'operador' });
  const draft = await s.osCreate();
  const o = await planned(s);
  const so = new Services(db, { userId: op.id });
  assert.deepEqual((await so.osList()).map((x) => x.id), [o.id]);
  await assert.rejects(so.osGet(draft.id), /não encontrada/);
  await assert.rejects(so.osCreate(), /permissão/);
  await assert.rejects(so.osDelete(o.id), /permissão/);
  await assert.rejects(so.osSaveAgendamento(o.id, {}), /permissão/);
  await assert.rejects(so.dashboard({ from: '2026-11-01', to: '2026-11-30' }), /permissão/);
  await assert.rejects(so.tankAdd('TQ-1'), /permissão/);
  await assert.rejects(so.backupExport(), /permissão/);
  const c = await so.osSaveFinal(o.id, { staff_real: 2, start_at: '2026-11-10T08:00', end_at: '2026-11-10T10:00', realized: 'sim' }, { conclude: true });
  assert.equal(c.status, 'concluida');
});

test('Programação diária agrupa por bloco e ignora rascunhos', async () => {
  const { s } = await fresh();
  await s.osCreate();
  await planned(s, { type: 'transferencia', tanks: ['TQ-282002'], time: '09:00' });
  await planned(s, { type: 'pts', time: '07:00' });
  await planned(s, { type: 'pts', date: '2026-11-11' });
  const p = await s.programacao('2026-11-10');
  assert.equal(p.total, 2);
  assert.equal(p.blocks.find((b) => b.id === 'transferencia').orders.length, 1);
  assert.equal(p.blocks.find((b) => b.id === 'aberturas').orders.length, 1);
  assert.equal(p.elaboratedBy, 'Gestora Teste');
  assert.ok(p.shifts.D && p.shifts.N);
});

test('Dashboard: ocupação, parciais contadas, avisos de dados', async () => {
  const { s } = await fresh();
  const conclude = (o, data) => s.osSaveFinal(o.id, data, { conclude: true });
  const a = await planned(s, { team_planned: 'A' });
  const b = await planned(s, { team_planned: 'A' });
  const c = await planned(s, { team_planned: 'B', type: 'maritima' });
  await planned(s, { team_planned: 'B' });
  await s.osCreate();
  await conclude(a, { staff_real: 4, start_at: '2026-11-10T08:00', end_at: '2026-11-10T13:00', realized: 'sim' });
  await conclude(b, { staff_real: 2, start_at: '2026-11-10T08:00', end_at: '2026-11-10T10:00', realized: 'parcial', occurrence: 'x' });
  await conclude(c, { staff_real: 1, start_at: '2026-11-10T08:00', end_at: '2026-11-10T09:00', realized: 'nao', occurrence: 'y', team_exec: 'C' });

  const d = await s.dashboard({ from: '2026-11-01', to: '2026-11-16' });
  assert.equal(d.metrics.total, 4);
  assert.equal(d.metrics.concluded, 3);
  assert.equal(d.metrics.pending, 1);
  assert.equal(d.metrics.notRealized, 1);
  const A = d.teams.find((t) => t.team === 'A');
  assert.equal(A.scheduledDays, 8);
  assert.equal(A.capacity, 8 * 4 * 10);
  assert.equal(A.realHours, 24);
  assert.equal(A.rate, 7.5);
  assert.equal(A.realized, 1);
  assert.equal(A.partial, 1);
  assert.equal(d.teams.find((t) => t.team === 'C').notRealized, 1);
  assert.equal(d.teams.find((t) => t.team === 'B').planned, 1);
  assert.equal(d.metrics.occupancy, Math.round((25 / (4 * 320)) * 10000) / 100);
  assert.equal(d.byType.find((t) => t.id === 'manutencao').count, 3);
  assert.equal(d.concludedWithHours, 3);
  await assert.rejects(s.dashboard({ from: '2026-11-10', to: '2026-11-01' }), /posterior/);
});

test('renomear tanque/cliente/produto migra as O.S.; limpar dados restaura estado inicial', async () => {
  const { s } = await fresh();
  const o = await planned(s, { type: 'maritima', tanks: ['TQ-282001', 'TQ-282002'], client: 'Cliente Exemplo 1', product: 'Diesel S10' });
  const lk = await s.lookups();
  assert.equal((await s.tankRename(lk.tanks.find((x) => x.code === 'TQ-282001').id, 'tq-900')).migrated, 1);
  assert.equal((await s.refRename('clients', lk.clients.find((x) => x.name === 'Cliente Exemplo 1').id, 'Novo Cliente')).migrated, 1);
  await s.refRename('products', lk.products.find((x) => x.name === 'Diesel S10').id, 'Diesel S-10');
  const g = await s.osGet(o.id);
  assert.deepEqual(g.tanks, ['TQ-900', 'TQ-282002']);
  assert.equal(g.client, 'Novo Cliente');
  assert.equal(g.product, 'Diesel S-10');

  await s.resetData();
  assert.equal((await s.osList()).length, 0);
  assert.ok((await s.lookups()).tanks.some((x) => x.code === 'TQ-282001'));
  assert.ok((await s.usersList()).length >= 1);
});

test('imagem do tanque é puxada automaticamente para O.S. marítima/transferência', async () => {
  const { s } = await fresh();
  const t = (await s.lookups()).tanks.find((x) => x.code === 'TQ-282003');
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  await s.tankSetImage(t.id, img, 'fluxograma.png');
  await assert.rejects(s.tankSetImage(t.id, 'data:text/html;base64,AAAA'), /não suportado/);
  const m = await planned(s, { type: 'transferencia', tanks: ['TQ-282003'] });
  assert.equal((await s.osGet(m.id)).tank_images[0].image_data, img);
  const a = await planned(s, { type: 'adequacao', tanks: ['TQ-282003'] });
  assert.equal((await s.osGet(a.id)).tank_images.length, 0);
});

test('persistência em arquivo e backup JSON (exportar → restaurar)', async () => {
  const file = path.join(tmpDir, 'persist.sqlite');
  let db = await Database.open(file);
  let s = new Services(db);
  await s.setup({ name: 'G', username: 'gestor', password: 'segredo1' });
  const o = await s.osCreate();
  const backup = JSON.parse(JSON.stringify(await s.backupExport()));
  db.close();

  db = await Database.open(file);
  s = new Services(db);
  await s.login({ username: 'gestor', password: 'segredo1' });
  assert.equal((await s.osGet(o.id)).number, o.number);
  await s.osDelete(o.id);
  const { token } = await s.sessionCreate(s.user.id);

  assert.throws(() => Database.validateBackup({ foo: 1 }), /inválido/);
  await s.backupImport(backup);
  assert.equal(await s.sessionResolve(token), null); // restauração encerra as sessões
  const s2 = new Services(db);
  await s2.login({ username: 'gestor', password: 'segredo1' });
  assert.equal((await s2.osGet(o.id)).number, o.number);
  assert.equal((await s2.osCreate()).number, '2026-0002');
});

test('router converte erros de negócio em mensagens', async () => {
  const { s } = await fresh();
  await s.logout();
  const r = await dispatch(s, 'os:list', {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUTH');
  assert.equal((await dispatch(s, 'nao:existe')).ok, false);
});
