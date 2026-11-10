'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: 'desktop',
  call: (channel, payload) => ipcRenderer.invoke('api', channel, payload),
  savePdf: (html, filename) => ipcRenderer.invoke('pdf:save', { html, filename }),
  info: () => ipcRenderer.invoke('app:info'),
});
