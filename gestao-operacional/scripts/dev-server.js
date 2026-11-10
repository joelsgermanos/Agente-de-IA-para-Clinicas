'use strict';
/**
 * Servidor de DESENVOLVIMENTO: abre a mesma interface no navegador (localhost) usando as mesmas regras
 * de negócio e o mesmo banco SQLite. Não é usado pelo aplicativo instalado.
 *   node scripts/dev-server.js [--port 5173] [--db caminho.sqlite | --memory]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Database } = require('../src/main/db');
const { Services } = require('../src/main/services');
const { dispatch } = require('../src/main/router');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(opt('--port', 5173));
const DB_FILE = args.includes('--memory') ? null : path.resolve(opt('--db', path.join(__dirname, '..', '.dev-data', 'dev.sqlite')));
const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const SHIM = '<script src="__web-shim.js"></script>';
const SHIM_JS = `window.api = {
  platform: 'web',
  call: (channel, payload) => fetch('/api/' + channel, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) }).then((r) => r.json()),
};`;

(async () => {
  const db = await Database.open(DB_FILE);
  const services = new Services(db);
  http
    .createServer(async (req, res) => {
      try {
        if (req.method === 'POST' && req.url.startsWith('/api/')) {
          let body = '';
          for await (const chunk of req) body += chunk;
          const result = await dispatch(services, decodeURIComponent(req.url.slice(5)), body ? JSON.parse(body) : {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result));
        }
        if (req.url === '/__web-shim.js') {
          res.writeHead(200, { 'Content-Type': TYPES['.js'] });
          return res.end(SHIM_JS);
        }
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
        const file = path.join(ROOT, rel);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404);
          return res.end('Not found');
        }
        let content = fs.readFileSync(file);
        if (rel === 'index.html') content = content.toString().replace('<script src="assets/logo.js"></script>', SHIM + '\n  <script src="assets/logo.js"></script>');
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(content);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    })
    .listen(PORT, '127.0.0.1', () => console.log(`Interface de desenvolvimento: http://127.0.0.1:${PORT}  (banco: ${DB_FILE || 'memória'})`));
})();
