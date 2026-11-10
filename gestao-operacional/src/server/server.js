'use strict';
/**
 * Servidor web do Gestão Operacional (versão navegador / nuvem).
 * Serve a interface e a API, com login por usuário/senha e sessão em cookie HttpOnly.
 *
 * Variáveis de ambiente:
 *   PORT                  porta HTTP (padrão 8080; o Render define sozinho)
 *   TURSO_DATABASE_URL    banco na nuvem (libsql://...)  — obrigatório em produção no Render
 *   TURSO_AUTH_TOKEN      token do banco Turso
 *   DATABASE_FILE         arquivo SQLite local (uso fora da nuvem; padrão ./data/gestao-operacional.sqlite)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Database } = require('../main/db');
const { Services } = require('../main/services');
const { dispatch } = require('../main/router');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..', 'renderer');
const MAX_BODY = 30 * 1024 * 1024;
const COOKIE = 'gs_session';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ------------------------------------------------------------------ limite de tentativas de login
const failures = new Map(); // ip -> { count, until }
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
function isLocked(ip) {
  const f = failures.get(ip);
  return f && f.count >= MAX_FAILS && f.until > Date.now();
}
function registerFail(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + LOCK_MS });
  else f.count++;
}

// ------------------------------------------------------------------ utilitários HTTP
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(req, value, maxAge) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function baseHeaders(req, extra = {}) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}
function sendJson(req, res, status, obj, extra = {}) {
  res.writeHead(status, baseHeaders(req, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Requisição grande demais.'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ------------------------------------------------------------------ API
async function handleApi(db, req, res, channel) {
  // Proteção CSRF: só aceita JSON vindo da mesma origem.
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return sendJson(req, res, 415, { ok: false, error: 'Tipo de conteúdo inválido.' });
  }
  const origin = req.headers.origin;
  let originHost = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch (_) {
    originHost = 'inválida';
  }
  if (origin && originHost !== req.headers.host) {
    return sendJson(req, res, 403, { ok: false, error: 'Origem não permitida.' });
  }
  const ip = clientIp(req);
  if ((channel === 'auth:login' || channel === 'auth:setup') && isLocked(ip)) {
    return sendJson(req, res, 429, { ok: false, error: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' });
  }

  let payload = {};
  const raw = await readBody(req);
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      return sendJson(req, res, 400, { ok: false, error: 'JSON inválido.' });
    }
  }

  const token = parseCookies(req)[COOKIE];
  const probe = new Services(db);
  const userId = await probe.sessionResolve(token);
  const services = new Services(db, { userId });
  const result = await dispatch(services, channel, payload);

  const headers = {};
  if (channel === 'auth:login' || channel === 'auth:setup') {
    if (result.ok && services.user) {
      failures.delete(ip);
      if (token) await probe.sessionDestroy(token);
      const s = await probe.sessionCreate(services.user.id);
      headers['Set-Cookie'] = cookie(req, s.token, s.maxAge);
    } else if (!result.ok && channel === 'auth:login') {
      registerFail(ip);
    }
  }
  if (channel === 'auth:logout' || (channel === 'backup:import' && result.ok)) {
    await probe.sessionDestroy(token);
    headers['Set-Cookie'] = cookie(req, '', 0);
  }
  return sendJson(req, res, 200, result, headers);
}

// ------------------------------------------------------------------ arquivos estáticos
function serveStatic(req, res) {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, baseHeaders(req, { 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('Página não encontrada');
  }
  res.writeHead(
    200,
    baseHeaders(req, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=300',
    })
  );
  fs.createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------ início
async function openDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) return Database.open(url, process.env.TURSO_AUTH_TOKEN);
  if (process.env.RENDER) {
    // O disco do plano gratuito do Render é apagado a cada reinício: sem banco externo, os dados se perderiam.
    throw new Error(
      'TURSO_DATABASE_URL não configurado. No Render, defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN (veja o README) — ' +
        'sem isso os dados seriam apagados a cada reinício do servidor.'
    );
  }
  const file = path.resolve(process.env.DATABASE_FILE || path.join(__dirname, '..', '..', 'data', 'gestao-operacional.sqlite'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return Database.open(file);
}

async function start() {
  const db = await openDatabase();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/healthz') return sendJson(req, res, 200, { ok: true });
      if (req.url.startsWith('/api/')) {
        if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'Método não permitido.' });
        return await handleApi(db, req, res, decodeURIComponent(req.url.slice(5).split('?')[0]));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { ok: false, error: 'Método não permitido.' });
      return serveStatic(req, res);
    } catch (e) {
      console.error('[erro]', req.method, req.url, e);
      if (!res.headersSent) sendJson(req, res, e.status || 500, { ok: false, error: e.status ? e.message : 'Erro interno do servidor.' });
      else res.end();
    }
  });
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Gestão Operacional no ar: http://localhost:${PORT}  (banco: ${process.env.TURSO_DATABASE_URL ? 'Turso' : db.url})`);
  return { server, db };
}

if (require.main === module) {
  start().catch((e) => {
    console.error('Falha ao iniciar:', e.message);
    process.exit(1);
  });
}

module.exports = { start };
