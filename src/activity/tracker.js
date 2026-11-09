// Aktivitaets-Tracker im Main-Prozess: verbindet native Module (uiohook-napi, active-win)
// und HTTP mit der reinen Logik in controller.js. Native Module werden lazy und in
// try/catch geladen: fehlen sie oder sind sie defekt, ist nur der Tracker aus, nie das Overlay.
const path = require('path');
const fs = require('fs');
const { createController } = require('./controller');

function loadNative(platform = process.platform) {
  let uIOhook = null;
  let activeWin = null;
  try { uIOhook = require('uiohook-napi').uIOhook || null; } catch (e) { uIOhook = null; }
  try {
    const dir = path.dirname(require.resolve('active-win/package.json'));
    // active-win liefert ohne Binary still undefined; deshalb vorab pruefen.
    let present = true;
    if (platform === 'win32') {
      const bindings = path.join(dir, 'lib', 'binding');
      present = fs.existsSync(bindings) && fs.readdirSync(bindings).some((d) => d.includes('win32'));
    } else if (platform === 'darwin') {
      present = fs.existsSync(path.join(dir, 'main'));
    }
    if (present) activeWin = require('active-win');
  } catch (e) { activeWin = null; }
  return { uIOhook, activeWin };
}

function makeHttp(baseUrl, deviceHeaders) {
  return (method, p, { headers = {}, body } = {}) => new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(baseUrl + p);
      const lib = u.protocol === 'http:' ? require('http') : require('https');
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const h = { ...(deviceHeaders || {}), ...headers, Accept: 'application/json' };
      if (payload !== null) {
        h['Content-Type'] = 'application/json';
        h['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = lib.request({
        hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method, headers: h,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (data.length < 65536) data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (e) { json = null; }
          fin({ status: res.statusCode, json });
        });
        res.on('error', () => fin({ status: 0, json: null }));
      });
      req.on('error', () => fin({ status: 0, json: null }));
      req.setTimeout(15000, () => { req.destroy(); fin({ status: 0, json: null }); });
      if (payload !== null) req.write(payload);
      req.end();
    } catch (e) {
      fin({ status: 0, json: null });
    }
  });
}

// startTracker({ opsUrl, deviceHeaders, store, onState, consentVersion, permHeader, canStartHooks })
//   -> { stop(), state(), refresh(), consent(args), revoke() }
function startTracker({
  opsUrl, deviceHeaders, store, onState, consentVersion,
  permHeader = () => null, canStartHooks = () => true, _native,
}) {
  const nat = _native || loadNative();
  const missing = !nat.uIOhook || !nat.activeWin;
  let registered = false;
  let running = false;
  let ctl = null;

  const native = {
    startHooks() {
      if (!nat.uIOhook) throw new Error('uiohook missing');
      if (!canStartHooks()) return false;
      if (running) return true;
      if (!registered) {
        nat.uIOhook.on('keydown', () => { try { ctl.onKey(); } catch (e) {} });
        nat.uIOhook.on('mousedown', () => { try { ctl.onMouse('down'); } catch (e) {} });
        nat.uIOhook.on('wheel', () => { try { ctl.onMouse('wheel'); } catch (e) {} });
        nat.uIOhook.on('mousemove', () => { try { ctl.onMouse('move'); } catch (e) {} });
        registered = true;
      }
      nat.uIOhook.start();
      running = true;
      return true;
    },
    stopHooks() {
      if (!running || !nat.uIOhook) return;
      running = false;
      try { nat.uIOhook.stop(); } catch (e) {}
    },
    async activeWindow() {
      if (!nat.activeWin) throw new Error('active-win missing');
      const w = await nat.activeWin({ accessibilityPermission: false, screenRecordingPermission: false });
      if (!w) return null;
      // appName = Prozess-/Owner-Name, nie ein Fenstertitel.
      return { appName: (w.owner && w.owner.name) || '', title: w.title || '', url: w.url || '' };
    },
  };

  ctl = createController({
    store,
    http: makeHttp(opsUrl, deviceHeaders),
    consentVersion,
    native,
    permHeader,
    onState,
  });
  if (missing) ctl.disable();
  ctl.start();

  return {
    stop: () => { try { ctl.stop(); } catch (e) {} },
    state: () => ctl.state(),
    refresh: () => ctl.refresh(),
    consent: (args) => ctl.consent(args),
    revoke: () => ctl.revoke(),
  };
}

module.exports = { startTracker, loadNative, makeHttp };
