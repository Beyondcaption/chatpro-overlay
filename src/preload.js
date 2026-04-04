const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatpro', {
  getSettings:     ()      => ipcRenderer.invoke('get-settings'),
  saveSettings:    (s)     => ipcRenderer.invoke('save-settings', s),
  getApiKey:       ()      => ipcRenderer.invoke('get-api-key'),
  getDeepLKey:     ()      => ipcRenderer.invoke('get-deepl-key'),
  deeplTranslate:  (args)  => ipcRenderer.invoke('deepl-translate', args),
  copyToClipboard: (text)  => ipcRenderer.invoke('copy-to-clipboard', text),
  closeOverlay:    ()      => ipcRenderer.invoke('close-overlay'),
  closeSettings:   ()      => ipcRenderer.invoke('close-settings'),
  openSettings:    ()      => ipcRenderer.invoke('open-settings'),
  openUrl:         (url)   => ipcRenderer.invoke('open-url', url),
  checkUpdate:     ()      => ipcRenderer.invoke('check-update'),
  getLearning:     ()      => ipcRenderer.invoke('get-learning'),
  saveOutcome:     (data)  => ipcRenderer.invoke('save-outcome', data),
  saveRules:       (rules) => ipcRenderer.invoke('save-rules', rules),
  saveExample:     (ex)    => ipcRenderer.invoke('save-example', ex),
  onSetDeText:     (cb)    => ipcRenderer.on('set-de-text', (e, text) => cb(text)),
});
