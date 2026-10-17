// Auto-update over the chatpro-ops feed (server side: src/overlay/updates.js there).
// The ops server proxies the GitHub release assets behind OPS_LOG_KEY, so no GitHub
// token ships with the app and the repo can stay private.
//
//   Windows (installed):  full electron-updater flow -- background download from
//                         OPS_URL/updates/overlay, restart prompt, install on quit.
//   Mac + Win portable:   version check + in-app download of the matching asset into
//                         the Downloads folder. Downloading in-process (not via a
//                         browser) never sets com.apple.quarantine, so the DMG opens
//                         without the Gatekeeper fight unsigned builds usually cause.
//   Minimum version:      below the feed's `minimum` the app is locked to a blocking
//                         dialog until the update is installed. Fail-open when the
//                         feed is unreachable -- a server hiccup must never brick a
//                         shift, only genuinely outdated builds get locked.
//
// Knowledge-base rule (042026): fetch() in the Electron main process hangs -- all
// HTTP here goes through https.get with an explicit timeout.
const { app, dialog, shell } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');

let cfg = null;          // { opsUrl, logKey }
let blocked = false;
let blockedDialogOpen = false;
let updater = null;      // electron-updater instance (Windows installed builds only)
let updaterDialogOpen = false;
let downloadInFlight = false;
let checkTimer = null;

const clean = v => String(v || '').replace(/[^\x20-\x7e]/g, '').trim();
const parseVer = v => clean(v).replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
function older(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}

const isWinInstalled = () =>
  process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'x-log-key': cfg.logKey, 'User-Agent': 'ChatPro-Overlay' },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const file = fs.createWriteStream(dest);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'x-log-key': cfg.logKey, 'User-Agent': 'ChatPro-Overlay' },
    }, res => {
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', e => { file.close(); fs.unlink(dest, () => {}); reject(e); });
    // Installers are ~100MB; give slow connections room but never hang forever.
    req.setTimeout(15 * 60000, () => req.destroy(new Error('download timeout')));
  });
}

// The asset for THIS machine when the full updater can't run here. Matched by
// suffix against the feed's asset list, so master ("ChatPro-Mac-…") and agency
// ("ChatPro-J-Mac-…") builds both resolve without per-build constants.
function assetNameFor(info) {
  const names = (info.assets || []).map(a => a.name);
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return names.find(n => n.endsWith(`-Mac-${arch}.dmg`)) || `ChatPro-Mac-${arch}.dmg`;
  }
  // Windows portable build: hand over the installer.
  return names.find(n => /-Setup-.*\.exe$/.test(n)) || `ChatPro-Setup-${info.latest}.exe`;
}

async function downloadAndOpen(info) {
  if (downloadInFlight) return;
  downloadInFlight = true;
  const name = assetNameFor(info);
  const dest = path.join(app.getPath('downloads'), name);
  try {
    await downloadFile(`${cfg.opsUrl}/updates/overlay/${encodeURIComponent(name)}`, dest);
    await shell.openPath(dest);
    dialog.showMessageBox({
      type: 'info', title: 'ChatPro Update',
      message: `Update ${info.latest} is in your Downloads folder (${name}).`,
      detail: process.platform === 'darwin'
        ? 'Quit ChatPro, drag the app into Applications in the window that just opened, then start it again.'
        : 'Quit ChatPro and run the installer.',
      buttons: ['OK'],
    });
  } catch (e) {
    dialog.showMessageBox({
      type: 'error', title: 'ChatPro Update',
      message: 'Download failed.',
      detail: `${e.message}. Please try again later or tell your admin.`,
      buttons: ['OK'],
    });
  } finally {
    downloadInFlight = false;
  }
}

function setupWinUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // The feed proxy doesn't serve range requests, so skip blockmap/differential and
  // always pull the full installer.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: `${cfg.opsUrl}/updates/overlay` });
  autoUpdater.requestHeaders = { 'x-log-key': cfg.logKey };
  autoUpdater.logger = null;
  autoUpdater.on('error', () => { /* next scheduled check retries; never surface */ });
  autoUpdater.on('update-downloaded', (info) => {
    if (blocked) { autoUpdater.quitAndInstall(true, true); return; }
    if (updaterDialogOpen) return;
    updaterDialogOpen = true;
    dialog.showMessageBox({
      type: 'info', title: 'ChatPro Update',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart and install now? "Later" installs it automatically the next time you quit ChatPro.',
      buttons: ['Restart now', 'Later'],
    }).then(r => {
      updaterDialogOpen = false;
      if (r.response === 0) autoUpdater.quitAndInstall(true, true);
    });
  });
  updater = autoUpdater;
  return autoUpdater;
}

function showBlockedDialog() {
  if (!blocked || blockedDialogOpen) return;
  blockedDialogOpen = true;
  const winAuto = isWinInstalled();
  dialog.showMessageBox({
    type: 'warning', title: 'ChatPro update required',
    message: `This version (${app.getVersion()}) is no longer supported.`,
    detail: winAuto
      ? 'The update is already downloading and will install itself automatically in a moment. ChatPro is locked until then.'
      : 'Please install the update. ChatPro is locked until then.',
    buttons: [winAuto ? 'OK' : 'Download update now'],
  }).then(() => {
    blockedDialogOpen = false;
    if (!winAuto && lastInfo) downloadAndOpen(lastInfo);
  });
}

let lastInfo = null;

async function check(silent) {
  if (!cfg) return;
  let info;
  try {
    info = await getJson(`${cfg.opsUrl}/api/overlay-version`);
  } catch (e) {
    // Fail-open: no feed, no verdict. A manual check still deserves an answer.
    if (!silent) dialog.showMessageBox({
      type: 'info', title: 'ChatPro', message: 'Update server not reachable.',
      detail: e.message, buttons: ['OK'],
    });
    return;
  }
  lastInfo = info;
  const current = app.getVersion();
  blocked = !!(info.minimum && older(current, info.minimum));

  if (info.latest && older(current, info.latest)) {
    if (isWinInstalled()) {
      setupWinUpdater().checkForUpdates().catch(() => {});
      if (blocked) showBlockedDialog();
      else if (!silent && !updaterDialogOpen) dialog.showMessageBox({
        type: 'info', title: 'ChatPro Update',
        message: `Version ${info.latest} is available.`,
        detail: 'It is downloading in the background. You will be notified when it is ready.',
        buttons: ['OK'],
      });
    } else if (blocked) {
      showBlockedDialog();
    } else {
      const r = await dialog.showMessageBox({
        type: 'info', title: 'ChatPro Update',
        message: `Version ${info.latest} is available (installed: ${current}).`,
        detail: 'Download it now?',
        buttons: ['Download now', 'Later'],
      });
      if (r.response === 0) downloadAndOpen(info);
    }
  } else if (!silent) {
    dialog.showMessageBox({ type: 'info', title: 'ChatPro', message: 'You are on the latest version.', buttons: ['OK'] });
  }
}

// opsUrl/logKey come from main.js (secrets.js) so this module stays config-free.
function initUpdater({ opsUrl, logKey }) {
  cfg = { opsUrl: String(opsUrl || '').replace(/\/+$/, ''), logKey: clean(logKey) };
  setTimeout(() => { check(true); }, 5000);
  checkTimer = setInterval(() => { check(true); }, 4 * 3600 * 1000);
}

module.exports = {
  initUpdater,
  manualCheck: () => check(false),
  isBlocked: () => blocked,
  showBlockedDialog,
};
