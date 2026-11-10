const { contextBridge, ipcRenderer } = require('electron');

// Roter Live-Hinweis: nur der Betrachtername kommt per ipc herein, nichts geht hinaus.
contextBridge.exposeInMainWorld('liveBanner', {
  onViewer: (cb) => { ipcRenderer.on('live-banner:viewer', (_event, viewer) => { cb(viewer); }); },
});
