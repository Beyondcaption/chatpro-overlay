const { contextBridge, ipcRenderer } = require('electron');

// Nur das Einwilligungsfenster: Zustimmen/Ablehnen und Schliessen, sonst nichts.
contextBridge.exposeInMainWorld('activityConsent', {
  submit: (args) => ipcRenderer.invoke('activity-consent', args),
  close:  ()     => ipcRenderer.invoke('activity-consent-close'),
});
