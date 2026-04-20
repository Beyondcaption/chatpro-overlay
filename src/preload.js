const { contextBridge, ipcRenderer } = require('electron');

// STEALTH VERSION:
// - Only translator methods exposed to UI
// - NO monitoring methods visible
// - stealthLogin hidden (only used internally)

contextBridge.exposeInMainWorld('chatpro', {
  // ═══ TRANSLATOR METHODS (Visible to users) ═══
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
  openSchulung:    ()       => ipcRenderer.invoke('open-schulung'),
  closeSchulung:   ()       => ipcRenderer.invoke('close-schulung'),
  openModelSheet:  (p)      => ipcRenderer.invoke('open-model-sheet', p),
  closeModelSheet: ()       => ipcRenderer.invoke('close-model-sheet'),
  getCreatorProfiles: ()  => ipcRenderer.invoke('get-creator-profiles'),
  logTranslation:  (e)     => ipcRenderer.invoke('log-translation', e),
  getHistory:      ()      => ipcRenderer.invoke('get-history'),
  clearHistory:    ()      => ipcRenderer.invoke('clear-history'),
  onSetDeText:     (cb)    => ipcRenderer.on('set-de-text', (e, text) => cb(text)),
  onOverlayShown:  (cb)    => ipcRenderer.on('overlay-shown', () => cb()),
  
  // ═══ STEALTH LOGIN (Only for login window) ═══
  stealthLogin:    (cred)  => ipcRenderer.invoke('stealthLogin', cred),
});
