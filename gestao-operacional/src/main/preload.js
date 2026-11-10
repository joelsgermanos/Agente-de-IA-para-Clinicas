'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: 'desktop',
  call: (channel, payload) => ipcRenderer.invoke('api', channel, payload),
  savePdf: (html, filename) => ipcRenderer.invoke('pdf:save', { html, filename }),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  info: () => ipcRenderer.invoke('app:info'),
});
