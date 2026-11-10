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

async function fresh(now = new Date('2026-11-10T10:00:00')) {
  const db = await Database.open(null);
  const s = new Services(db, { now: () => now });
  s.setup({ name: 'Gestora Teste', username: 'gestor', password: 'segredo1' });
  return { db, s };
}

async function planned(s, data = {}) {
  const o = s.osCreate();
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
  // cada equipe: 4 dias diurno seguidos de 4 noturno
  const seq = Array.from({ length: 16 }, (_, i) => D.teamShift('A', D.addDays('2026-01-01', i))).join('');
  assert.equal(seq, 'DDDDNNNNFFFFFFFF');
});

test('setup cria Gestor com senha em hash e login exige senha correta', async () => {
  const { db, s } = await fresh();
  const row = db.get('SELECT * FROM users WHERE username = ?', ['gestor']);
  assert.notEqual(row.password_hash, 'segredo1');
  assert.ok(row.password_salt);
  s.logout();
  assert.throws(() => s.login({ username: 'gestor', password: 'errada' }), /inválidos/);
  assert.equal(s.login({ username: 'GESTOR', password: 'segredo1' }).user.role, 'gestor');
  assert.throws(() => s.setup({ name: 'x', username: 'outro', password: '123456' }), /já foi configurado/);
});

test('Logins: só cria Planejador/Operador; Gestor não é removível', async () => {
  const { s } = await fresh();
  assert.throws(() => s.usersAdd({ name: 'G2', username: 'g2', password: '123456', role: 'gestor' }), /Planejador ou Operador/);
  const op = s.usersAdd({ name: 'Op', username: 'op1', password: '123456', role: 'operador' });
  assert.equal(op.role, 'operador');
  assert.throws(() => s.usersAdd({ name: 'Op', username: 'op1', password: '123456', role: 'operador' }), /Já existe/);
  assert.throws(() => s.usersRemove(s.user.id), /próprio/);
});

test('numeração AAAA-NNNN a partir do maior número do ano corrente', async () => {
  const { s } = await fresh();
  const a = s.osCreate();
  const b = s.osCreate();
  assert.equal(a.number, '2026-0001');
  assert.equal(b.number, '2026-0002');
  s.osDelete(a.id);
  assert.equal(s.osCreate().number, '2026-0003');
  s.now = () => new Date('2027-01-02T10:00:00');
  assert.equal(s.osCreate().number, '2027-0001');
});

test('planejamento exige campos obrigatórios; tanques só para tipos com tanque; cliente só marítima', async () => {
  const { s } = await fresh();
  const o = s.osCreate();
  assert.throws(() => s.osSaveAgendamento(o.id, { type: 'maritima' }, { plan: true }), /Descrição.*Data.*Hora/);
  const draft = s.osSaveAgendamento(o.id, { type: 'manutencao', tanks: ['TQ-282001'], client: 'Cliente Exemplo 1' });
  assert.equal(draft.status, 'rascunho');
  assert.deepEqual(draft.tanks, []);
  assert.equal(draft.client, null);
  const p = s.osSaveAgendamento(o.id, { type: 'maritima', description: 'Descarga navio', date: '2026-11-10', time: '07:00', tanks: ['TQ-282001'], client: 'Cliente Exemplo 1', volume: '5000 m3' }, { plan: true });
  assert.equal(p.status, 'planejada');
  assert.deepEqual(p.tanks, ['TQ-282001']);
  assert.equal(p.block, 'aquaviarias');
  assert.throws(() => s.osSaveAgendamento(o.id, { type: 'maritima', description: 'x', date: '2026-11-10', time: '07:00', tanks: ['TQ-999'] }), /não está cadastrado/);
});

test('aba Final: bloqueada em rascunho, exige dados de execução e final após início', async () => {
  const { s } = await fresh();
  const d = s.osCreate();
  assert.throws(() => s.osSaveFinal(d.id, {}, { conclude: true }), /só é liberada/);
  const o = await planned(s);
  assert.throws(() => s.osSaveFinal(o.id, { realized: 'sim' }, { conclude: true }), /Efetivo.*Início.*Final/);
  assert.throws(
    () => s.osSaveFinal(o.id, { staff_real: 3, start_at: '2026-11-10T10:00', end_at: '2026-11-10T09:00', realized: 'sim' }, { conclude: true }),
    /posterior ao início/
  );
  assert.throws(
    () => s.osSaveFinal(o.id, { staff_real: 3, start_at: '2026-11-10T08:00', end_at: '2026-11-10T12:00', realized: 'parcial' }, { conclude: true }),
    /Detalhe da ocorrência/
  );
  const c = s.osSaveFinal(o.id, { staff_real: 3, start_at: '2026-11-10T20:00', end_at: '2026-11-11T02:30', realized: 'parcial', occurrence: 'Chuva' }, { conclude: true });
  assert.equal(c.status, 'concluida');
  assert.equal(c.hours_worked, 6.5);
  assert.throws(() => s.osSaveFinal(o.id, {}), /Reabra/);
  assert.equal(s.osReopen(o.id).status, 'planejada');
});

test('Operador: não vê rascunhos, não cria nem exclui, mas preenche a Final', async () => {
  const { s } = await fresh();
  s.usersAdd({ name: 'Op', username: 'oper', password: '123456', role: 'operador' });
  const draft = s.osCreate();
  const o = await planned(s);
  s.logout();
  s.login({ username: 'oper', password: '123456' });
  assert.deepEqual(s.osList().map((x) => x.id), [o.id]);
  assert.throws(() => s.osGet(draft.id), /não encontrada/);
  assert.throws(() => s.osCreate(), /permissão/);
  assert.throws(() => s.osDelete(o.id), /permissão/);
  assert.throws(() => s.osSaveAgendamento(o.id, {}), /permissão/);
  assert.throws(() => s.dashboard({ from: '2026-11-01', to: '2026-11-30' }), /permissão/);
  assert.throws(() => s.tankAdd('TQ-1'), /permissão/);
  const c = s.osSaveFinal(o.id, { staff_real: 2, start_at: '2026-11-10T08:00', end_at: '2026-11-10T10:00', realized: 'sim' }, { conclude: true });
  assert.equal(c.status, 'concluida');
});

test('Programação diária agrupa por bloco e ignora rascunhos', async () => {
  const { s } = await fresh();
  s.osCreate();
  await planned(s, { type: 'transferencia', tanks: ['TQ-282002'], time: '09:00' });
  await planned(s, { type: 'pts', time: '07:00' });
  await planned(s, { type: 'pts', date: '2026-11-11' });
  const p = s.programacao('2026-11-10');
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
  await planned(s, { team_planned: 'B' }); // continua planejada
  s.osCreate(); // rascunho: fora de tudo
  conclude(a, { staff_real: 4, start_at: '2026-11-10T08:00', end_at: '2026-11-10T13:00', realized: 'sim' }); // 20h
  conclude(b, { staff_real: 2, start_at: '2026-11-10T08:00', end_at: '2026-11-10T10:00', realized: 'parcial', occurrence: 'x' }); // 4h
  conclude(c, { staff_real: 1, start_at: '2026-11-10T08:00', end_at: '2026-11-10T09:00', realized: 'nao', occurrence: 'y', team_exec: 'C' }); // 1h equipe C

  const d = s.dashboard({ from: '2026-11-01', to: '2026-11-16' }); // 16 dias = 1 ciclo
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
  const C = d.teams.find((t) => t.team === 'C');
  assert.equal(C.notRealized, 1); // equipe executante tem prioridade sobre a prevista
  assert.equal(d.teams.find((t) => t.team === 'B').planned, 1);
  assert.equal(d.metrics.occupancy, Math.round((25 / (4 * 320)) * 10000) / 100);
  assert.equal(d.byType.find((t) => t.id === 'manutencao').count, 3);
  assert.equal(d.concludedWithHours, 3);
  assert.throws(() => s.dashboard({ from: '2026-11-10', to: '2026-11-01' }), /posterior/);
});

test('renomear tanque/cliente/produto migra as O.S.; limpar dados restaura estado inicial', async () => {
  const { s } = await fresh();
  const o = await planned(s, { type: 'maritima', tanks: ['TQ-282001', 'TQ-282002'], client: 'Cliente Exemplo 1', product: 'Diesel S10' });
  const t = s.lookups().tanks.find((x) => x.code === 'TQ-282001');
  assert.equal(s.tankRename(t.id, 'tq-900').migrated, 1);
  const cl = s.lookups().clients.find((x) => x.name === 'Cliente Exemplo 1');
  assert.equal(s.refRename('clients', cl.id, 'Novo Cliente').migrated, 1);
  const pr = s.lookups().products.find((x) => x.name === 'Diesel S10');
  s.refRename('products', pr.id, 'Diesel S-10');
  const g = s.osGet(o.id);
  assert.deepEqual(g.tanks, ['TQ-900', 'TQ-282002']);
  assert.equal(g.client, 'Novo Cliente');
  assert.equal(g.product, 'Diesel S-10');

  s.resetData();
  assert.equal(s.osList().length, 0);
  assert.ok(s.lookups().tanks.some((x) => x.code === 'TQ-282001'));
  assert.ok(s.usersList().length >= 1);
});

test('imagem do tanque é puxada automaticamente para O.S. marítima/transferência', async () => {
  const { s } = await fresh();
  const t = s.lookups().tanks.find((x) => x.code === 'TQ-282003');
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  s.tankSetImage(t.id, img, 'fluxograma.png');
  assert.throws(() => s.tankSetImage(t.id, 'data:text/html;base64,AAAA'), /não suportado/);
  const m = await planned(s, { type: 'transferencia', tanks: ['TQ-282003'] });
  assert.equal(s.osGet(m.id).tank_images[0].image_data, img);
  const a = await planned(s, { type: 'adequacao', tanks: ['TQ-282003'] });
  assert.equal(s.osGet(a.id).tank_images.length, 0);
});

test('persistência em arquivo e validação de backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestao-test-'));
  const file = path.join(dir, 'db.sqlite');
  let db = await Database.open(file);
  let s = new Services(db);
  s.setup({ name: 'G', username: 'gestor', password: 'segredo1' });
  const o = s.osCreate();
  db.close();
  db = await Database.open(file);
  s = new Services(db);
  s.login({ username: 'gestor', password: 'segredo1' });
  assert.equal(s.osGet(o.id).number, o.number);
  await Database.validateBackup(db.export());
  await assert.rejects(Database.validateBackup(Buffer.from('não é sqlite')), /inválido/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('router converte erros de negócio em mensagens', async () => {
  const { s } = await fresh();
  s.logout();
  const r = await dispatch(s, 'os:list', {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUTH');
  assert.equal((await dispatch(s, 'nao:existe')).ok, false);
});
