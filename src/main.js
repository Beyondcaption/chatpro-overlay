const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu, nativeImage, screen, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
// ── Simple GitHub update checker ──
function checkForUpdates(silent) {
  if (silent === undefined) silent = true;
  var https = require('https');
  var options = {
    hostname: 'api.github.com',
    path: '/repos/Beyondcaption/chatpro-overlay/releases/latest',
    headers: { 'User-Agent': 'ChatPro-Overlay' }
  };
  https.get(options, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      try {
        var data = JSON.parse(body);
        var latest = data.tag_name || '';
        var current = 'v' + app.getVersion();
        if (latest && latest !== current) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Update verfuegbar',
            message: 'Version ' + latest + ' verfuegbar!',
            detail: 'Jetzt herunterladen?',
            buttons: ['Ja', 'Spaeter']
          }).then(function(r) {
            if (r.response === 0) {
              shell.openExternal('https://github.com/Beyondcaption/chatpro-overlay/releases/latest');
            }
          });
        } else if (!silent) {
          dialog.showMessageBox({
            type: 'info',
            title: 'ChatPro',
            message: 'Neueste Version installiert.',
            buttons: ['OK']
          });
        }
      } catch(e) { console.error('[UPDATE]', e.message); }
    });
  }).on('error', function(e) { console.error('[UPDATE]', e.message); });
}

// ── Simple JSON file store ──
const storePath = path.join(app.getPath('userData'), 'settings.json');
function loadStore() {
  try { if (fs.existsSync(storePath)) return JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch(e) {}
  return {};
}
function saveStore(data) {
  try { fs.mkdirSync(path.dirname(storePath), { recursive: true }); fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8'); } catch(e) { console.error('Store save error:', e); }
}
const store = {
  _data: null,
  _load() { if (!this._data) this._data = loadStore(); },
  get(key, def) { this._load(); return this._data[key] !== undefined ? this._data[key] : def; },
  set(key, val) { this._load(); this._data[key] = val; saveStore(this._data); },
};

let overlayWindow  = null;
let settingsWindow = null;
let tray           = null;
let lastClipboard  = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.whenReady().then(() => {
  createTray();
  registerHotkey();
  watchClipboard();
  if (!store.get('apiKey')) {
    openSettings();
  }
  // Check for updates after 3 seconds
  setTimeout(() => checkForUpdates(true), 3000);
  app.on('activate', () => {});
});

app.on('window-all-closed', (e) => { e.preventDefault(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// ── Tray ──
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'ChatPro Overlay', enabled: false },
    { type: 'separator' },
    { label: 'Übersetzen (Ctrl+Shift+T)', click: () => showOverlay() },
    { label: 'Einstellungen', click: () => openSettings() },
    { label: 'Nach Updates suchen', click: () => checkForUpdates(false) },
    { type: 'separator' },
    { label: 'ChatPro beenden', click: () => app.exit(0) },
  ]);
  tray.setToolTip('ChatPro Overlay — läuft');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => tray.popUpContextMenu());
}

// ── Hotkey ──
function registerHotkey() {
  const hotkey = store.get('hotkey', 'CommandOrControl+Shift+T');
  try {
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(hotkey, () => showOverlay());
    if (!ok) console.error('Hotkey registration failed:', hotkey);
  } catch(e) {
    globalShortcut.register('CommandOrControl+Shift+T', () => showOverlay());
  }
}

// ── Clipboard watcher ──
function watchClipboard() {
  lastClipboard = clipboard.readText().trim();
  setInterval(() => {
    if (!store.get('autoDetect', true)) return;
    try {
      const text = clipboard.readText().trim();
      if (text && text !== lastClipboard && text.length > 2 && text.length < 3000) {
        lastClipboard = text;
        if (looksGerman(text)) showOverlay(text);
      }
    } catch(e) {}
  }, 400);
}

function looksGerman(text) {
  if (/[äöüÄÖÜß]/.test(text)) return true;
  const words = /(\s|^)(ich|du|er|sie|es|wir|ihr|ein|eine|der|die|das|ist|war|hat|haben|und|für|mit|nicht|aber|auch|noch|schon|wie|was|wo|wann|wenn|dann|doch|mal|nur|so|ja|nein|bitte|danke|hallo|hey|ach|okay|auf|von|zu|im|am|an|bei|nach|vor|sehr|viel|mehr|schön|gut|toll|geil|krass|alter|digga|echt|genau|klar|leider|vielleicht|eigentlich|irgendwie|einfach|immer|nie|alles|nichts|jetzt|heute|morgen|gestern|hier|da|warum|wieso|wer|mein|meine|dein|deine|sein|kein|keine)(\s|$|[?!.,])/i;
  return words.test(text);
}

// ── Overlay window ──
function showOverlay(autoText = '') {
  const { x, y } = screen.getCursorScreenPoint();
  const display   = screen.getDisplayNearestPoint({ x, y });
  const { bounds } = display;
  const winW = 480, winH = 580;
  let wx = x + 20, wy = y - 100;
  if (wx + winW > bounds.x + bounds.width)  wx = x - winW - 10;
  if (wy + winH > bounds.y + bounds.height) wy = bounds.y + bounds.height - winH - 20;
  if (wy < bounds.y) wy = bounds.y + 20;

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setPosition(wx, wy);
    overlayWindow.show();
    overlayWindow.focus();
    if (autoText) overlayWindow.webContents.send('set-de-text', autoText);
    return;
  }

  overlayWindow = new BrowserWindow({
    width: winW, height: winH, x: wx, y: wy,
    frame: false, transparent: false, alwaysOnTop: true,
    skipTaskbar: true, resizable: true, movable: true, show: false,
    backgroundColor: '#111114',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show(); overlayWindow.focus();
    if (autoText) overlayWindow.webContents.send('set-de-text', autoText);
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

// ── Settings window ──
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  settingsWindow = new BrowserWindow({
    width: 480, height: 560,
    x: Math.round((width - 480) / 2), y: Math.round((height - 560) / 2),
    frame: false, transparent: false, resizable: false, show: false,
    backgroundColor: '#111114',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; registerHotkey(); });
}

// ── IPC ──
ipcMain.handle('get-settings', () => ({
  apiKey:     store.get('apiKey', ''),
  deeplKey:   store.get('deeplKey', ''),
  hotkey:     store.get('hotkey', 'CommandOrControl+Shift+T'),
  autoDetect: store.get('autoDetect', true),
  subProfile: store.get('subProfile', ''),
  version:    app.getVersion(),
}));
ipcMain.handle('save-settings', (e, s) => {
  if (s.apiKey     !== undefined) store.set('apiKey',     s.apiKey);
  if (s.deeplKey   !== undefined) store.set('deeplKey',   s.deeplKey);
  if (s.hotkey     !== undefined) store.set('hotkey',     s.hotkey);
  if (s.autoDetect !== undefined) store.set('autoDetect', s.autoDetect);
  if (s.subProfile !== undefined) store.set('subProfile', s.subProfile);
  registerHotkey();
  return { ok: true };
});
ipcMain.handle('get-api-key',       () => store.get('apiKey', ''));
ipcMain.handle('get-deepl-key',     () => store.get('deeplKey', ''));
ipcMain.handle('copy-to-clipboard', (e, text) => { clipboard.writeText(text); lastClipboard = text; return { ok: true }; });
ipcMain.handle('close-overlay',     () => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); });
ipcMain.handle('close-settings',    () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); });
ipcMain.handle('open-settings',     () => openSettings());
ipcMain.handle('open-url',          (e, url) => shell.openExternal(url));
ipcMain.handle('check-update',      () => { checkForUpdates(false); return { ok: true }; });
ipcMain.handle('get-learning', () => ({
  examples:  store.get('examples',  []),
  feedbacks: store.get('feedbacks', []),
  rules:     store.get('learnedRules', ''),
  total:     store.get('totalTranslations', 0),
}));
ipcMain.handle('save-outcome', (e, { deText, replyText, outcome }) => {
  const feedbacks = store.get('feedbacks', []);
  feedbacks.push({ deText, replyText, outcome, ts: Date.now() });
  if (feedbacks.length > 200) feedbacks.splice(0, feedbacks.length - 200);
  store.set('feedbacks', feedbacks);
  return { shouldEvolve: feedbacks.length % 15 === 0, feedbackCount: feedbacks.length };
});
ipcMain.handle('save-rules',   (e, rules) => { store.set('learnedRules', rules); const t = store.get('totalTranslations', 0) + 1; store.set('totalTranslations', t); });
ipcMain.handle('save-example', (e, ex)    => { const ex2 = store.get('examples', []); ex2.push(ex); if (ex2.length > 50) ex2.splice(0, ex2.length - 50); store.set('examples', ex2); });
