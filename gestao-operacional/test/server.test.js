'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gestao-srv-'));
process.env.DATABASE_FILE = path.join(dir, 'srv.sqlite');
process.env.PORT = '0';
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER;
const { start } = require('../src/server/server');

let srv;
let base;
test.before(async () => {
  srv = await start();
  base = `http://127.0.0.1:${srv.server.address().port}`;
});
test.after(() => {
  srv.server.close();
  srv.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(channel, payload, cookie, headers = {}) {
  const r = await fetch(`${base}/api/${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: JSON.stringify(payload || {}),
  });
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json(), cookie: setCookie ? setCookie.split(';')[0] : null, raw: setCookie };
}

test('servidor web: login cria sessão em cookie HttpOnly e protege a API', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /web-api\.js/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(base + '/../package.json')).status, 404);

  assert.equal((await call('os:list')).body.code, 'AUTH');

  const setup = await call('auth:setup', { name: 'Ana', username: 'ana', password: 'segredo1' });
  assert.equal(setup.body.ok, true);
  assert.match(setup.raw, /HttpOnly/);
  assert.match(setup.raw, /SameSite=Strict/);
  const gestor = setup.cookie;

  const created = await call('os:create', {}, gestor);
  assert.equal(created.body.data.number.slice(5), '0001');
  await call('users:add', { name: 'Op', username: 'oper', password: '123456', role: 'operador' }, gestor);

  // sessões independentes por usuário
  const opLogin = await call('auth:login', { username: 'oper', password: '123456' });
  assert.equal(opLogin.body.data.user.role, 'operador');
  const opList = await call('os:list', {}, opLogin.cookie);
  assert.equal(opList.body.data.length, 0); // rascunho oculto ao operador
  assert.equal((await call('os:list', {}, gestor)).body.data.length, 1);
  assert.equal((await call('os:create', {}, opLogin.cookie)).body.code, 'PERM');

  // logout invalida a sessão
  await call('auth:logout', {}, opLogin.cookie);
  assert.equal((await call('os:list', {}, opLogin.cookie)).body.code, 'AUTH');
});

test('servidor web: CSRF e limite de tentativas de login', async () => {
  const form = await fetch(`${base}/api/os:list`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(form.status, 415);
  const cross = await call('auth:status', {}, null, { Origin: 'https://site-malicioso.example' });
  assert.equal(cross.status, 403);

  let last;
  for (let i = 0; i < 9; i++) last = await call('auth:login', { username: 'ana', password: 'errada' }, null, { 'X-Forwarded-For': '203.0.113.9' });
  assert.equal(last.status, 429);
  const other = await call('auth:login', { username: 'ana', password: 'segredo1' }, null, { 'X-Forwarded-For': '203.0.113.10' });
  assert.equal(other.body.ok, true);
});
