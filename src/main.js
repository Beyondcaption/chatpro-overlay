const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu, nativeImage, screen, shell, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs   = require('fs');

// ═══════════════════════════════════════════════════════════════════
// CHATPRO PRODUCTION: TRANSLATOR
// Komplett SILENT - keine DevTools, keine console.logs, keine Spuren
// ═══════════════════════════════════════════════════════════════════

const SERVER_URL = 'https://monitoring-relay-production.up.railway.app';
// chatpro-ops QA backend: log which logged-in employee produced each used reply,
// so the QA dashboard can attribute flagged mistakes to a chatter. Read-only ops.
const OPS_URL = 'https://chatpro-ops-production.up.railway.app';
const { RULES_KEY, OPS_LOG_KEY } = require('./secrets');
const updater = require('./updater');

// Device identity for the ops device log: stable hashed machine id (survives IP,
// network and VPN changes) plus hostname and OS user, sent as headers with every
// chatter-log post. Best-effort: a failure here must never break logging itself,
// and header values must be ASCII-clean or https.request throws.
const DEVICE_HEADERS = (() => {
  try {
    const os = require('os');
    const { machineIdSync } = require('node-machine-id');
    const clean = v => String(v || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80);
    const h = {};
    const id = clean(machineIdSync());
    if (!id) return {};
    h['x-device-id'] = id;
    const name = clean(os.hostname());
    if (name) h['x-device-name'] = name;
    const user = clean(os.userInfo().username);
    if (user) h['x-device-user'] = user;
    // Build version, so the ops IP-Log tab can show who runs which release.
    const ver = clean(app.getVersion());
    if (ver) h['x-app-version'] = ver;
    return h;
  } catch (e) { return {}; }
})();

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

// ── Activity tracker (consent-based, only while clocked in) ──
// The logic lives in src/activity/ (controller.js is pure and unit-tested); main.js only
// wires Electron to it. Any tracker failure disables the tracker, never the overlay.
let activityLib = null;
try { activityLib = { ...require('./activity/tracker'), ...require('./activity/controller'), ...require('./activity/livepoll') }; } catch (e) { activityLib = null; }
// Consent text version comes from consent.html (data-version), the single source of truth.
const ACTIVITY_CONSENT_VERSION = (() => {
  try {
    const m = fs.readFileSync(path.join(__dirname, 'consent.html'), 'utf8').match(/data-version="([^"]+)"/);
    return m ? m[1] : '2026-11-09';
  } catch (e) { return '2026-11-09'; }
})();
// Dev only: point the tracker at a local chatpro-ops (e.g. http://localhost:3000).
const ACTIVITY_URL = (!app.isPackaged && process.env.CHATPRO_ACTIVITY_URL) || OPS_URL;
let tracker = null;
let consentWindow = null;
let consentShownThisRun = false;
let accessDialogShown = false;
let activityState = { track: false, reason: 'starting', label: 'Activity tracking: starting' };

// ── Update checks live in src/updater.js (ops-server feed, not GitHub direct) ──
// The old api.github.com/releases/latest check is gone: it needs the repo to stay
// public and can only open a browser link. The feed flow auto-installs on Windows,
// downloads in-app on Mac, and enforces a server-set minimum version.

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
let overlayFocusedSince = 0;

// ══════════════════════════════════════════════════════════════════
// LOGIN STATE
// ══════════════════════════════════════════════════════════════════
let isLoggedIn = false;
let currentUser = null;

// ── Language detection (scored) ──
// Each language has a diacritic pattern (unambiguous, worth 2 points) and a
// word list restricted to words that don't collide with English or the other
// two languages (worth 1 point per distinct match). Scoring — not a single
// boolean match — is what lets us tell a genuine foreign-language message
// apart from a single borrowed word ("ciao", "si", "yes") dropped into an
// otherwise clearly German/Spanish/Italian sentence.
const LANG_PATTERNS = {
  es: {
    diacritics: /[¿¡ñÑáéíóúÁÉÍÓÚ]/,
    words: /(\s|^)(que|con|para|pero|como|hola|gracias|quiero|tengo|eres|estas|estás|hoy|mañana|ayer|porque|nunca|siempre|mucho|poco|bien|mal|amor|contigo|conmigo|verdad|claro|entonces|todavia|todavía|tambien|también|nada|algo|alguien|donde|dónde|cuando|cuándo)(\s|$|[?!.,])/gi,
  },
  it: {
    diacritics: /[àèéìòù]/i,
    words: /(\s|^)(che|sono|tuo|tua|voglio|sei|ciao|grazie|perche|perché|adesso|domani|ieri|oggi|sempre|niente|qualcosa|qualcuno|dove|quando|come|allora|davvero|vabbe|vabbè|boh|magari|piuttosto|comunque)(\s|$|[?!.,])/gi,
  },
  de: {
    // removed from word list: er,sie,es,ist,war,hat,haben,was,wo,da,mal,nur,so,ja,nein,hey,okay,am,an,bei,gut,alter,wer,hier,nie,im,viel,ach
    diacritics: /[äöüÄÖÜß]/,
    words: /(\s|^)(ich|du|wir|ihr|ein|eine|der|die|das|und|für|mit|nicht|aber|auch|noch|schon|wie|wann|wenn|dann|doch|bitte|danke|hallo|auf|von|zu|nach|vor|sehr|mehr|schön|toll|geil|krass|digga|echt|genau|klar|leider|vielleicht|eigentlich|irgendwie|einfach|immer|alles|nichts|jetzt|heute|morgen|gestern|warum|wieso|mein|meine|dein|deine|sein|kein|keine|ne|nee)(\s|$|[?!.,])/gi,
  },
};

function scoreLanguage(text, lang) {
  const p = LANG_PATTERNS[lang];
  let score = 0;
  if (p.diacritics.test(text)) score += 2;
  const matches = text.match(p.words);
  if (matches) score += matches.length;
  return score;
}

function looksInLanguage(text, lang) {
  return scoreLanguage(text, lang) > 0;
}

// ── Clipboard watcher ──
function watchClipboard() {
  lastClipboard = clipboard.readText().trim();
  if (clipboardInterval) clearInterval(clipboardInterval);
  clipboardInterval = setInterval(() => {
    const overlayFocused = !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible() && overlayWindow.isFocused());
    if (overlayFocused) {
      if (!overlayFocusedSince) overlayFocusedSince = Date.now();
    } else {
      overlayFocusedSince = 0;
    }

    if (!store.get('autoDetect', true)) return;
    if (Date.now() < suppressAutoDetect) return;
    try {
      const text = clipboard.readText().trim();
      if (text && text !== lastClipboard && text.length > 2 && text.length < 3000) {
        lastClipboard = text;
        // If overlay is open and focused, user is copying from within it — don't re-trigger.
        // Capped at 3s: alwaysOnTop windows can occasionally fail to release OS focus on
        // Windows, which would otherwise disable auto-detect until the overlay is closed.
        if (overlayFocused && (Date.now() - overlayFocusedSince) < 3000) return;

        const currentLang = store.get('language', 'de');
        const scores = { de: scoreLanguage(text, 'de'), es: scoreLanguage(text, 'es'), it: scoreLanguage(text, 'it') };
        let best = currentLang, bestScore = scores[currentLang];
        for (const l of ['de', 'es', 'it']) {
          if (scores[l] > bestScore) { best = l; bestScore = scores[l]; }
        }

        // Switch only on a clear, multi-signal match (>=2 points) for a language
        // other than the active one — a single borrowed word ("ciao", "si", "yes")
        // scores 1 and never flips the active language on its own.
        if (store.get('autoLangSwitch', true) && best !== currentLang && bestScore >= 2) {
          store.set('language', best);
          showOverlay(text, best);
        } else if (scores[currentLang] > 0) {
          showOverlay(text);
        }
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
let clipboardInterval = null;
function showOverlay(autoText, switchLang) {
  // Min-version gate: a locked build shows only the update dialog, never the overlay.
  if (updater.isBlocked()) { updater.showBlockedDialog(); return; }
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
      const sendText = () => {
        if (!overlayWindow || overlayWindow.isDestroyed()) return;
        if (switchLang) overlayWindow.webContents.send('auto-switch-language', switchLang);
        overlayWindow.webContents.send('set-de-text', autoText);
      };
      if (overlayWindow.webContents.isLoading()) {
        overlayWindow.webContents.once('did-finish-load', sendText);
      } else {
        sendText();
      }
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
    if (autoText) {
      if (switchLang) overlayWindow.webContents.send('auto-switch-language', switchLang);
      overlayWindow.webContents.send('set-de-text', autoText);
    }
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
    /* Charcoal Ink, same tokens as overlay.html and the chatpro-ops dashboard */
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: #121212;
      color: #ededed;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }
    .login-box { width: 320px; }
    .head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .brand-mark {
      width: 28px; height: 28px; border-radius: 6px; background: #f3f3f3; color: #121212;
      display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;
    }
    h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    input {
      width: 100%;
      padding: 10px 12px;
      margin-bottom: 8px;
      background: #212121;
      border: 1px solid #2a2a2a;
      color: #ededed;
      border-radius: 6px;
      font: inherit;
      font-size: 13px;
    }
    input::placeholder { color: #8f8f8f; }
    input:focus { outline: none; border-color: #d0d0d0; }
    button {
      width: 100%;
      margin-top: 4px;
      padding: 11px;
      background: #f3f3f3;
      color: #121212;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      font-size: 13px;
    }
    button:hover { background: #fff; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .error {
      color: #ef6b5e;
      font-size: 12px;
      margin-top: 10px;
      display: none;
    }
    .info {
      font-size: 12px;
      color: #8f8f8f;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="head"><span class="brand-mark">C</span><h2>Activate ChatPro</h2></div>
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
    
    document.addEventListener('keydown', function(e) {
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
    globalShortcut.register('CommandOrControl+Shift+T', () => showOverlay(null));
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
  updateTrayMenu();
  tray.on('click', () => showOverlay(null));
}

// Tray menu with the visible activity status as first entry (rebuilt on every status change).
function updateTrayMenu() {
  if (!tray) return;
  try {
    const label = activityState.label || 'Activity tracking: off';
    const needsConsent = activityState.reason === 'no_consent' || activityState.reason === 'old_consent';
    tray.setToolTip('ChatPro\n' + label);
    const items = [
      { label, enabled: false },
    ];
    if (needsConsent && tracker) items.push({ label: 'Activity consent...', click: () => openConsent() });
    items.push({ label: 'Revoke consent', click: () => revokeActivity() });
    items.push({ type: 'separator' }, ...staticTrayItems());
    tray.setContextMenu(Menu.buildFromTemplate(items));
  } catch (e) {
    // Never lose Quit/Settings: fall back to the original static menu.
    try {
      tray.setToolTip('ChatPro');
      tray.setContextMenu(Menu.buildFromTemplate(staticTrayItems()));
    } catch (e2) {}
  }
}

function staticTrayItems() {
  return [
    { label: 'Open ChatPro', click: () => showOverlay(null) },
    { label: 'Schulung', click: () => openSchulung() },
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Check for updates', click: () => updater.manualCheck() },
    { type: 'separator' },
    { label: 'Quit ChatPro', click: () => app.quit() },
  ];
}

// ══════════════════════════════════════════════════════════════════
// ACTIVITY TRACKER WIRING
// ══════════════════════════════════════════════════════════════════

function macAccessibilityTrusted() {
  if (process.platform !== 'darwin') return true;
  try { return systemPreferences.isTrustedAccessibilityClient(false); } catch (e) { return false; }
}

function activityUsername() {
  const who = currentUser || store.get('_sys', null);
  // Relay LOGIN name (not the display name): the server checks the password with it.
  return !who ? '' : (typeof who === 'string' ? who : (who.username || who.name || ''));
}

function onActivityState(s) {
  try {
    activityState = s;
    updateTrayMenu();
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('activity-state', s);
    maybeShowConsent();
    // Live-Poller läuft nur während getrackter Schicht (Einstempeln, Einwilligung, keine Pause).
    if (s.track) startLivePoller(); else stopLivePoller();
    if (s.track && !macAccessibilityTrusted()) showAccessibilityDialog();
  } catch (e) {}
}

function startActivity() {
  if (!activityLib) {
    activityState = { track: false, reason: 'error', label: 'Activity tracking: error' };
    updateTrayMenu();
    return;
  }
  try {
    tracker = activityLib.startTracker({
      opsUrl: ACTIVITY_URL,
      deviceHeaders: DEVICE_HEADERS,
      store,
      consentVersion: ACTIVITY_CONSENT_VERSION,
      // Always sent on /state (non-Mac: always 'ok'); the server keeps it per device.
      permHeader: () => (macAccessibilityTrusted() ? 'ok' : 'no-accessibility'),
      canStartHooks: () => macAccessibilityTrusted(),
      username: isLoggedIn ? activityUsername() : '',
      onState: onActivityState,
    });
    // The first status can arrive synchronously inside startTracker(), before `tracker`
    // is set; re-run the status consumers once it is.
    onActivityState(tracker.state());
  } catch (e) {
    tracker = null;
    activityState = { track: false, reason: 'error', label: 'Activity tracking: error' };
    updateTrayMenu();
  }
}

// ══════════════════════════════════════════════════════════════════
// LIVE VIEW (Teil 2): Poller, verstecktes Capture-Fenster, roter Hinweis
// ══════════════════════════════════════════════════════════════════
let livePoller = null;
let liveWindow = null;
let liveBannerWindow = null;
let liveWaiter = null; // { resolve, timer } für das Offer des Renderers

// Gerätetoken wird je Anfrage aus dem Store gelesen (ASCII-bereinigt, sonst wirft https.request).
function liveHttp() {
  const base = activityLib.makeHttp(ACTIVITY_URL, DEVICE_HEADERS);
  return (method, p, opts = {}) => {
    const tok = String(store.get('_act', null) || '').replace(/[^\x20-\x7e]/g, '');
    if (!tok) return Promise.resolve({ status: 0, json: null });
    return base(method, p, { ...opts, headers: { ...(opts.headers || {}), 'x-activity-token': tok } });
  };
}

let liveGen = 0; // Zähler: jede Schließung entwertet laufende begin()-Aufrufe

function closeLiveWindow() {
  liveGen++;
  try {
    if (liveWaiter) { clearTimeout(liveWaiter.timer); liveWaiter.resolve(null); liveWaiter = null; }
    if (liveWindow && !liveWindow.isDestroyed()) {
      try { liveWindow.webContents.send('live:stop'); } catch (e) {}
      liveWindow.destroy();
    }
  } catch (e) {}
  liveWindow = null;
}

const liveCapture = {
  // Öffnet das versteckte Fenster, startet die Aufnahme aller Monitore, liefert {sdp, candidates}.
  async begin({ id, iceServers }) {
    closeLiveWindow();
    const g = liveGen;
    // Vorbereitung (getSources + loadFile) mit 20 s Timeout; bei Timeout wird alles geschlossen.
    let to = null;
    const timeout = new Promise((resolve) => { to = setTimeout(() => { closeLiveWindow(); resolve(null); }, 20000); });
    try {
      return await Promise.race([timeout, liveBegin(g, iceServers)]);
    } finally { clearTimeout(to); }
  },
  remote(payload) {
    if (liveWindow && !liveWindow.isDestroyed()) liveWindow.webContents.send('live:remote', payload);
  },
  stop() { closeLiveWindow(); },
};

async function liveBegin(g, iceServers) {
  {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    if (g !== liveGen) return null; // inzwischen gestoppt: keine Aufnahme starten
    const sourceIds = sources.map(s => s.id);
    if (!sourceIds.length) return null;
    const win = new BrowserWindow({
      show: false, width: 320, height: 240,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload-live.js'),
        backgroundThrottling: false,
        devTools: false,
      },
    });
    liveWindow = win;
    win.on('closed', () => { if (liveWindow === win) liveWindow = null; });
    await win.loadFile(path.join(__dirname, 'live.html'));
    if (g !== liveGen || liveWindow !== win) { try { if (!win.isDestroyed()) win.destroy(); } catch (e) {} return null; }
    const offer = new Promise((resolve) => {
      const timer = setTimeout(() => { liveWaiter = null; resolve(null); }, 20000);
      liveWaiter = { resolve, timer };
    });
    win.webContents.send('live:start', { sourceIds, iceServers: iceServers || [] });
    return offer;
  }
}

ipcMain.on('live:offer', (event, payload) => {
  try {
    if (!liveWindow || event.sender !== liveWindow.webContents) return;
    if (liveWaiter) {
      const w = liveWaiter; liveWaiter = null; clearTimeout(w.timer);
      w.resolve(payload && typeof payload.sdp === 'string' ? { sdp: payload.sdp, candidates: Array.isArray(payload.candidates) ? payload.candidates : [] } : null);
    }
  } catch (e) {}
});
ipcMain.on('live:candidate', (event, cand) => {
  try {
    if (!liveWindow || event.sender !== liveWindow.webContents) return;
    if (livePoller) livePoller.candidate(cand);
  } catch (e) {}
});

// Roter Hinweis: eigenes rahmenloses Fenster, über allem, auch über Vollbild.
function showLiveBanner(viewer) {
  try {
    if (!liveBannerWindow || liveBannerWindow.isDestroyed()) {
      const { width } = screen.getPrimaryDisplay().workArea;
      const w = 360;
      liveBannerWindow = new BrowserWindow({
        width: w, height: 34, x: Math.round((width - w) / 2), y: 0,
        frame: false, transparent: true, resizable: false, movable: false, focusable: false,
        skipTaskbar: true, show: false, hasShadow: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload-banner.js'),
          devTools: false,
        },
      });
      liveBannerWindow.setAlwaysOnTop(true, 'screen-saver');
      liveBannerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      liveBannerWindow.setIgnoreMouseEvents(true);
      liveBannerWindow.on('closed', () => { liveBannerWindow = null; });
      liveBannerWindow.loadFile(path.join(__dirname, 'live-banner.html'));
    }
    const win = liveBannerWindow;
    const push = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('live-banner:viewer', viewer || '');
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', push); else push();
    return true;
  } catch (e) {
    // Fail-closed: Fenster nicht erstellbar -> false, der Poller startet dann keine Aufnahme.
    hideLiveBanner();
    return false;
  }
}

function hideLiveBanner() {
  try {
    if (liveBannerWindow && !liveBannerWindow.isDestroyed()) liveBannerWindow.destroy();
  } catch (e) {}
  liveBannerWindow = null;
}

function startLivePoller() {
  try {
    if (livePoller || !activityLib || !activityLib.createLivePoller) return;
    livePoller = activityLib.createLivePoller({
      http: liveHttp(),
      capture: liveCapture,
      onBanner: (b) => { if (b && b.active) return showLiveBanner(b.viewer); hideLiveBanner(); return true; },
    });
    livePoller.start();
  } catch (e) { livePoller = null; }
}

function stopLivePoller() {
  try { if (livePoller) livePoller.stop(); } catch (e) {}
  livePoller = null;
  closeLiveWindow();
  hideLiveBanner();
}

// Consent window once per app start: logged in, no (current) consent, this version not declined.
function maybeShowConsent() {
  try {
    if (!tracker || !activityLib) return;
    const show = activityLib.shouldShowConsent({
      loggedIn: isLoggedIn && !!activityUsername(),
      reason: activityState.reason,
      declinedVersion: store.get('_actDeclined', null),
      version: ACTIVITY_CONSENT_VERSION,
      shownThisRun: consentShownThisRun,
    });
    if (!show) return;
    consentShownThisRun = true;
    openConsent();
  } catch (e) {}
}

function openConsent() {
  try {
    if (consentWindow && !consentWindow.isDestroyed()) { consentWindow.show(); consentWindow.focus(); return; }
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    consentWindow = new BrowserWindow({
      width: 520, height: 560,
      x: Math.round((width - 520) / 2), y: Math.round((height - 560) / 2),
      frame: false, transparent: false, resizable: false, show: false,
      skipTaskbar: false,
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      backgroundColor: '#121212',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload-consent.js'),
        devTools: false
      },
    });
    consentWindow.loadFile(path.join(__dirname, 'consent.html'));
    consentWindow.once('ready-to-show', () => { if (consentWindow && !consentWindow.isDestroyed()) { consentWindow.show(); consentWindow.focus(); } });
    consentWindow.on('closed', () => { consentWindow = null; });
    setupWindowSecurity(consentWindow);
  } catch (e) {}
}

async function revokeActivity() {
  try {
    if (tracker) {
      await tracker.revoke();
    } else {
      // Tracker never started: still drop the local consent token and buffer.
      store.set('_act', null);
      store.set('_actBuf', []);
      store.set('_actDeclined', ACTIVITY_CONSENT_VERSION);
    }
    dialog.showMessageBox({ type: 'info', buttons: ['OK'], title: 'ChatPro', message: 'Consent revoked.', detail: 'Activity tracking is off on this computer. You can give consent again from the tray menu.' }).catch(() => {});
  } catch (e) {}
  return { ok: true };
}

// Mac: uiohook needs Accessibility. Without it no input is counted (the server is told via
// x-activity-perm); ask once per app start and offer to open the system prompt.
function showAccessibilityDialog() {
  if (process.platform !== 'darwin' || accessDialogShown) return;
  accessDialogShown = true;
  dialog.showMessageBox({
    type: 'info',
    buttons: ['Open settings', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'ChatPro activity tracking',
    message: 'ChatPro needs Accessibility access to count keys and mouse use.',
    detail: 'Turn on ChatPro in System Settings > Privacy & Security > Accessibility, then restart ChatPro.',
  }).then((r) => {
    if (r.response === 0) { try { systemPreferences.isTrustedAccessibilityClient(true); } catch (e) {} }
  }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════════
// APP INITIALIZATION
// ══════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  createTray();
  registerHotkey();
  watchClipboard();
  updater.initUpdater({ opsUrl: OPS_URL, logKey: OPS_LOG_KEY });
  
  // Check if user is already logged in
  const savedUser = store.get('_sys', null);
  if (savedUser) {
    isLoggedIn = true;
    currentUser = savedUser;
  } else {
    setTimeout(() => showStealthLogin(), 2000);
  }

  startActivity();
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (clipboardInterval) clearInterval(clipboardInterval);
  try { if (tracker) tracker.stop(); } catch (e) {}
  stopLivePoller();
});

// ══════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ══════════════════════════════════════════════════════════════════

ipcMain.handle('get-settings', () => ({
  apiKey:         store.get('apiKey', ''),
  deeplKey:       store.get('deeplKey', ''),
  hotkey:         store.get('hotkey', 'CommandOrControl+Shift+T'),
  autoDetect:     store.get('autoDetect', true),
  autoLangSwitch: store.get('autoLangSwitch', true),
  subProfile:     store.get('subProfile', ''),
  language:       store.get('language', 'de'),
  version:        app.getVersion(),
}));

ipcMain.handle('save-settings', (e, s) => {
  if (s.apiKey         !== undefined) store.set('apiKey',         s.apiKey);
  if (s.deeplKey       !== undefined) store.set('deeplKey',       s.deeplKey);
  if (s.hotkey         !== undefined) store.set('hotkey',         s.hotkey);
  if (s.autoDetect     !== undefined) store.set('autoDetect',     s.autoDetect);
  if (s.autoLangSwitch !== undefined) store.set('autoLangSwitch', s.autoLangSwitch);
  if (s.subProfile     !== undefined) store.set('subProfile',     s.subProfile);
  if (s.language       !== undefined) store.set('language',       s.language);

  registerHotkey();
  return { ok: true };
});

ipcMain.handle('get-api-key',   () => store.get('apiKey', ''));
ipcMain.handle('get-deepl-key', () => store.get('deeplKey', ''));

// Fetch creator profiles — token stays in main process, never reaches renderer
ipcMain.handle('get-creator-profiles', async () => {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.get(SERVER_URL + '/api/creator-profiles', {
        headers: { 'x-app-token': APP_TOKEN }
      }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { resolve({ success: false, profiles: [] }); }
        });
      });
      req.on('error', () => resolve({ success: false, profiles: [] }));
      req.setTimeout(8000, () => { req.destroy(); resolve({ success: false, profiles: [] }); });
    });
  } catch(e) {
    return { success: false, profiles: [] };
  }
});

// Gelernte Translator-Regeln von chatpro-ops holen (Token bleibt im Main-Prozess).
ipcMain.handle('get-learned-rules', async (event, account) => {
  try {
    const https = require('https');
    const url = OPS_URL + '/api/training/rules/active' + (account ? ('?account=' + encodeURIComponent(account)) : '');
    return new Promise((resolve) => {
      const req = https.get(url, { headers: { 'x-rules-key': RULES_KEY } }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve({ block: '' }); } });
      });
      req.on('error', () => resolve({ block: '' }));
      req.setTimeout(8000, () => { req.destroy(); resolve({ block: '' }); });
    });
  } catch (e) { return { block: '' }; }
});

ipcMain.handle('stealthLogin', async (event, { username, password }) => {
  try {
    const https = require('https');

    return new Promise((resolve) => {
      const parsedUrl = new URL(`${SERVER_URL}/api/login`);
      const body = JSON.stringify({ username, password });

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const result = JSON.parse(data);
              isLoggedIn = true;
              currentUser = result.user;
              store.set('_sys', currentUser);

              if (loginWindow && !loginWindow.isDestroyed()) {
                loginWindow.close();
              }
              // Freshly logged in: the consent window may now be due.
              // A different user on this device: drop the previous user's token and buffer.
              try { if (tracker) tracker.bindUser(activityUsername()).catch(() => {}); } catch (e) {}
              setTimeout(() => maybeShowConsent(), 1500);

              resolve({ ok: true });
            } else {
              resolve({ ok: false, error: 'Invalid credentials' });
            }
          } catch(e) {
            resolve({ ok: false, error: e.message });
          }
        });
      });
      
      req.on('error', (e) => {
        resolve({ ok: false, error: e.message });
      });
      
      req.write(body);
      req.end();
    });
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// DeepL translation — proxied through Railway server, key never in binary
// lang is the source language of `text` (de/es/it); back-translation target is always English.
// NOTE: server-side support for `lang` is unverified here (backend repo not present
// in this checkout) — if ES/IT back-translation comes back wrong or empty, the
// /api/deepl endpoint on the Railway backend needs a matching fix.
ipcMain.handle('deepl-translate', async (event, { text, lang }) => {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const body = JSON.stringify({ text, lang: lang || 'de' });
      const parsedUrl = new URL(`${SERVER_URL}/api/deepl`);
      const req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-app-token': APP_TOKEN
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { resolve({ ok: false, error: 'Parse error' }); }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      req.write(body);
      req.end();
    });
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// Claude relay fallback — used by the overlay only when the direct call to
// api.anthropic.com fails at network level (some ISPs block it; 082326 incident).
// The chatter's own Anthropic key travels along in x-api-key; the relay forwards
// the request 1:1 and stores nothing. Long timeout: generate with thinking can
// legitimately take a while.
ipcMain.handle('claude-relay', async (event, { apiKey, body } = {}) => {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const payload = JSON.stringify(body || {});
      const parsedUrl = new URL(`${SERVER_URL}/api/claude`);
      const req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-app-token': APP_TOKEN,
          'x-api-key': String(apiKey || '').replace(/[^\x21-\x7E]/g, '')
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve({ ok: true, status: res.statusCode, body: data }));
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.setTimeout(180000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      req.write(payload);
      req.end();
    });
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
  history.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (history.length > 500) history.length = 500;
  store.set('translationHistory', history);
  return { ok: true };
});

// Fire-and-forget: report the logged-in employee + used reply to chatpro-ops so the
// QA dashboard can name who made a flagged mistake. Never blocks or surfaces errors.
ipcMain.handle('report-chatter', (e, { account, text } = {}) => {
  try {
    const who = currentUser || store.get('_sys', null);
    const employee = !who ? '' : (typeof who === 'string' ? who : (who.name || who.username || ''));
    if (!employee || !text) return { ok: false };
    const https = require('https');
    const body = JSON.stringify({ employee, account: account || '', text });
    const u = new URL(`${OPS_URL}/api/chatter-log`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-log-key': OPS_LOG_KEY, ...DEVICE_HEADERS },
    }, (res) => { res.on('data', () => {}); res.on('end', () => {}); });
    req.on('error', () => {});
    req.setTimeout(5000, () => req.destroy());
    req.write(body);
    req.end();
    return { ok: true };
  } catch (e) { return { ok: false }; }
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
ipcMain.handle('open-url',       (e, url) => shell.openExternal(url));
ipcMain.handle('check-update',   () => { updater.manualCheck(); return { ok: true }; });

// ── Activity tracker IPC (every handler wrapped: errors never reach the overlay) ──
ipcMain.handle('activity-consent', async (e, { password, decision } = {}) => {
  try {
    // Only the consent window may give or decline consent.
    if (!consentWindow || consentWindow.isDestroyed() || e.sender !== consentWindow.webContents) return { ok: false, error: 'Please use the consent window.' };
    if (!tracker) return { ok: false, error: 'Activity tracking is not available on this computer.' };
    return await tracker.consent({
      username: activityUsername(),
      password: String(password || ''),
      decision: decision === 'accepted' ? 'accepted' : 'declined',
      deviceId: DEVICE_HEADERS['x-device-id'] || '',
    });
  } catch (err) {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
});
ipcMain.handle('activity-consent-close', () => {
  try { if (consentWindow && !consentWindow.isDestroyed()) consentWindow.close(); } catch (e) {}
  return { ok: true };
});
ipcMain.handle('activity-revoke', () => revokeActivity());
ipcMain.handle('activity-state', () => {
  try { return { ...activityState }; } catch (e) { return { track: false, reason: 'error', label: 'Activity tracking: error' }; }
});
ipcMain.handle('open-activity-consent', () => { try { if (tracker) openConsent(); } catch (e) {} return { ok: true }; });
