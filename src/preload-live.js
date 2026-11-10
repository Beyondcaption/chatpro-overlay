const { contextBridge, ipcRenderer } = require('electron');

// Verstecktes Live-Capture-Fenster: nur die WebRTC-Brücke, sonst nichts.
// Alle Member nutzen Block-Bodies, damit nie ipcRenderer an die Seite zurückgegeben wird.
contextBridge.exposeInMainWorld('live', {
  onStart: (cb) => { ipcRenderer.on('live:start', (_event, payload) => { cb(payload); }); },
  onRemote: (cb) => { ipcRenderer.on('live:remote', (_event, payload) => { cb(payload); }); },
  onStop: (cb) => { ipcRenderer.on('live:stop', () => { cb(); }); },
  sendOffer: (payload) => { ipcRenderer.send('live:offer', payload); },
  sendCandidate: (cand) => { ipcRenderer.send('live:candidate', cand); },
});
