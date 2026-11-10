'use strict';
/** Processo principal do Electron: janela, banco local, IPC, PDF e backup. Nenhuma chamada de rede. */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('./db');
const { Services } = require('./services');
const { dispatch } = require('./router');

// Permite apontar a pasta de dados (ex.: instalação portátil em pendrive ou testes).
// Pasta de dados fixa e sem acentos: com o productName acentuado ("Gestão Operacional") o Electron
// resolve userData para a própria pasta AppData/.config, misturando o banco com outros arquivos.
app.setPath(
  'userData',
  process.env.GESTAO_DATA_DIR ? path.resolve(process.env.GESTAO_DATA_DIR) : path.join(app.getPath('appData'), 'GestaoOperacional')
);

let mainWindow = null;
let db = null;
let services = null;

function dbFile() {
  return path.join(app.getPath('userData'), 'gestao-operacional.sqlite');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 500,
    backgroundColor: '#001869',
    title: 'Gestão Operacional',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Links externos nunca abrem dentro do app
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
}

/** Renderiza um documento HTML (gerado pela interface) em PDF localmente e salva onde o usuário escolher. */
async function savePdf({ html, filename }) {
  const tmp = path.join(os.tmpdir(), `gestao-op-print-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar PDF',
      defaultPath: path.join(app.getPath('documents'), (filename || 'documento').replace(/[\\/:*?"<>|]/g, '-') + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, pdf);
    shell.openPath(filePath);
    return { saved: true, filePath };
  } finally {
    win.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
}

async function exportBackup() {
  services.requireRole('gestor');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar backup do banco de dados',
    defaultPath: path.join(app.getPath('documents'), `backup-gestao-operacional-${stamp}.sqlite`),
    filters: [{ name: 'Backup do sistema', extensions: ['sqlite'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, db.export());
  return { saved: true, filePath };
}

async function importBackup() {
  services.requireRole('gestor');
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restaurar backup',
    properties: ['openFile'],
    filters: [{ name: 'Backup do sistema', extensions: ['sqlite', 'db'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { restored: false };
  const buf = fs.readFileSync(filePaths[0]);
  await Database.validateBackup(buf);
  // cópia de segurança do banco atual antes de substituir
  fs.writeFileSync(dbFile() + '.antes-da-restauracao', db.export());
  await db.replaceWith(buf);
  services.logout();
  return { restored: true };
}

function wrap(fn) {
  return async (_e, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  };
}

app.whenReady().then(async () => {
  // Bloqueia qualquer requisição de rede: o app é 100% local.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = /^(file|data|blob|devtools|chrome-extension):/.test(details.url);
    cb({ cancel: !ok });
  });

  db = await Database.open(dbFile());
  services = new Services(db);

  ipcMain.handle('api', (_e, channel, payload) => dispatch(services, channel, payload));
  ipcMain.handle('pdf:save', wrap(savePdf));
  ipcMain.handle('backup:export', wrap(exportBackup));
  ipcMain.handle('backup:import', wrap(importBackup));
  ipcMain.handle('app:info', wrap(async () => ({ version: app.getVersion(), dbPath: dbFile() })));

  if (!process.env.GESTAO_DEVTOOLS) Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.save();
  if (process.platform !== 'darwin') app.quit();
});
