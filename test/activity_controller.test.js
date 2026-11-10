const { test } = require('node:test');
const assert = require('node:assert');
const {
  createController, shouldShowConsent, trayLabel, consentErrorMessage, msUntilNextMinute,
} = require('../src/activity/controller');

const T0 = Date.parse('2026-11-09T12:00:30.500Z');
const VERSION = '2026-11-09';

// Fake-Uhr mit Timer-Warteschlange; advance() führt fällige Timer aus und lässt Promises laufen.
function fakeClock(start = T0) {
  let t = start;
  let seq = 0;
  const q = new Map();
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    now: () => t,
    setTimer(fn, ms) { const id = ++seq; q.set(id, { at: t + Math.max(0, ms), fn, id }); return id; },
    clearTimer(id) { q.delete(id); },
    pending() { return [...q.values()].map((x) => x.at - t).sort((a, b) => a - b); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await tick(); await tick();
        const due = [...q.values()].filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        q.delete(due.id);
        t = due.at;
        due.fn();
      }
      t = end;
      await tick(); await tick();
    },
    flush: async () => { for (let i = 0; i < 5; i++) await tick(); },
  };
}

function memStore(init = {}) {
  const d = { ...init };
  return { d, get: (k, def) => (d[k] !== undefined ? d[k] : def), set: (k, v) => { d[k] = v; } };
}

function fakeHttp(routes) {
  const calls = [];
  const fn = async (method, path, opts = {}) => {
    calls.push({ method, path, headers: opts.headers || {}, body: opts.body });
    const h = routes[method + ' ' + path];
    if (!h) return { status: 0, json: null };
    return typeof h === 'function' ? h(opts, calls) : h;
  };
  fn.calls = calls;
  return fn;
}

function setup({ store, routes, win, startHooks, perm } = {}) {
  const clock = fakeClock();
  const s = store || memStore({ _act: 'tok' });
  const http = fakeHttp(routes || { 'GET /api/activity/state': { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } } });
  const states = [];
  const native = {
    hookStarts: 0,
    startHooks: startHooks || (() => { native.hookStarts++; return true; }),
    hookStops: 0,
    stopHooks: () => { native.hookStops++; },
    activeWindow: win || (async () => ({ appName: 'Google Chrome', title: 'Inbox - OnlyMonster', url: '' })),
  };
  const c = createController({
    store: s, http, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    consentVersion: VERSION, native, permHeader: perm || (() => null), onState: (st) => states.push(st),
  });
  return { c, clock, store: s, http, states, native };
}

test('controller: ohne Token fragt /state ohne Token; 401 -> no_consent (Dialog möglich)', async () => {
  const { c, clock, http } = setup({ store: memStore({}), routes: { 'GET /api/activity/state': { status: 401, json: { error: 'unauthorized' } } } });
  c.start();
  await clock.flush();
  assert.equal(c.state().reason, 'no_consent');
  assert.equal(c.state().track, false);
  const calls = http.calls.filter((x) => x.path === '/api/activity/state');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-activity-token'], undefined);
  assert.equal(calls[0].headers['x-activity-perm'], 'ok');
  assert.equal(shouldShowConsent({ loggedIn: true, reason: c.state().reason, declinedVersion: null, version: VERSION, shownThisRun: false }), true);
  await clock.advance(60000);
  assert.equal(http.calls.filter((x) => x.path === '/api/activity/state').length, 2);
  c.stop();
});

test('controller: ohne Token und Feature aus (404) -> feature_off, kein Dialog, Re-Check nach 10 min', async () => {
  const { c, clock, http } = setup({ store: memStore({}), routes: { 'GET /api/activity/state': { status: 404, json: { error: 'activity tracking off' } } } });
  c.start();
  await clock.flush();
  assert.equal(c.state().reason, 'feature_off');
  assert.equal(shouldShowConsent({ loggedIn: true, reason: c.state().reason, declinedVersion: null, version: VERSION, shownThisRun: false }), false);
  await clock.advance(9 * 60000);
  assert.equal(http.calls.filter((x) => x.path === '/api/activity/state').length, 1);
  await clock.advance(60000);
  assert.equal(http.calls.filter((x) => x.path === '/api/activity/state').length, 2);
  c.stop();
});

test('controller: ohne Token und Netzfehler oder 500 -> status_unknown, kein Dialog in diesem Tick', async () => {
  let resp = { status: 0, json: null };
  const { c, clock } = setup({ store: memStore({}), routes: { 'GET /api/activity/state': () => resp } });
  c.start();
  await clock.flush();
  assert.equal(c.state().reason, 'status_unknown');
  resp = { status: 500, json: { error: 'server_error' } };
  await clock.advance(60000);
  assert.equal(c.state().reason, 'status_unknown');
  assert.equal(shouldShowConsent({ loggedIn: true, reason: c.state().reason, declinedVersion: null, version: VERSION, shownThisRun: false }), false);
  resp = { status: 401, json: { error: 'unauthorized' } };
  await clock.advance(60000);
  assert.equal(c.state().reason, 'no_consent');
  c.stop();
});

test('controller: x-activity-perm wird immer gesendet, Standard ok', async () => {
  const { c, clock, http } = setup();
  c.start();
  await clock.flush();
  assert.equal(http.calls.find((x) => x.path === '/api/activity/state').headers['x-activity-perm'], 'ok');
  c.stop();
});

test('controller: Wechsel auf track=false stoppt die OS-Hooks, track=true startet sie wieder', async () => {
  let track = true;
  const { c, clock, native } = setup({
    routes: { 'GET /api/activity/state': () => ({ status: 200, json: { track, reason: track ? 'ok' : 'off_shift', idleMin: 5, consentVersion: VERSION } }) },
  });
  c.start();
  await clock.flush();
  assert.equal(native.hookStarts, 1);
  assert.equal(native.hookStops, 0);
  track = false;
  await clock.advance(60000);
  assert.equal(c.state().reason, 'off_shift');
  assert.equal(native.hookStops, 1);
  await clock.advance(60000); // weiter aus: nicht erneut stoppen, nicht starten
  assert.equal(native.hookStops, 1);
  assert.equal(native.hookStarts, 1);
  track = true;
  await clock.advance(60000);
  assert.equal(c.state().track, true);
  assert.equal(native.hookStarts, 2);
  c.stop();
});

test('controller: Offline-Widerruf bleibt als _actPendingRevoke und wird nachgeholt bis 200/401/404', async () => {
  let revokeResp = { status: 0, json: null };
  const store = memStore({ _act: 'tok' });
  const { c, clock, http } = setup({
    store,
    routes: {
      'GET /api/activity/state': (o) => (o.headers['x-activity-token'] ? { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } } : { status: 401, json: { error: 'unauthorized' } }),
      'POST /api/activity/revoke': () => revokeResp,
    },
  });
  c.start();
  await clock.flush();
  assert.equal(c.state().track, true);
  await c.revoke();
  assert.deepEqual(store.get('_actPendingRevoke'), ['tok']);
  assert.equal(c.state().track, false);
  revokeResp = { status: 500, json: { error: 'server_error' } };
  await clock.advance(60000);
  const revokes = () => http.calls.filter((x) => x.path === '/api/activity/revoke');
  assert.equal(revokes().length, 2);
  assert.deepEqual(store.get('_actPendingRevoke'), ['tok']);
  assert.equal(c.state().track, false); // lokal bleibt es aus
  revokeResp = { status: 200, json: { ok: true } };
  await clock.advance(60000);
  assert.equal(revokes().length, 3);
  assert.equal(revokes()[2].headers['x-activity-token'], 'tok');
  assert.deepEqual(store.get('_actPendingRevoke'), []);
  await clock.advance(60000);
  assert.equal(revokes().length, 3); // nichts mehr offen
  // 401 und 404 beenden den Versuch ebenfalls
  for (const status of [401, 404]) {
    store.set('_actPendingRevoke', ['old' + status]);
    revokeResp = { status, json: {} };
    await clock.advance(60000);
    assert.deepEqual(store.get('_actPendingRevoke'), [], String(status));
  }
  c.stop();
});

test('controller: erste Minutengrenze genau an der vollen UTC-Minute', () => {
  assert.equal(msUntilNextMinute(T0), 29500);
  assert.equal(msUntilNextMinute(Date.parse('2026-11-09T12:00:00.000Z')), 60000);
});

test('controller: track=true zählt Tasten, Maus (mousemove max 1 je 500 ms), Seite; Zeile zur vollen Minute', async () => {
  const { c, clock, store, native } = setup();
  c.start();
  await clock.flush();
  assert.equal(c.state().track, true);
  assert.equal(c.state().reason, 'ok');
  assert.equal(native.hookStarts, 1);
  c.onKey(); c.onKey(); c.onKey();
  c.onMouse('down'); c.onMouse('wheel');
  c.onMouse('move'); c.onMouse('move'); c.onMouse('move'); // innerhalb 500 ms -> 1
  await clock.advance(10000); // zwei Fenster-Abfragen
  c.onMouse('move'); // > 500 ms später -> zählt
  await clock.advance(19500); // 12:01:00.000
  const rows = store.get('_actBuf', []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { minute: '2026-11-09T12:00:00.000Z', keys: 3, mouse: 4, site: 'OnlyMonster' });
  c.stop();
});

test('controller: track=false ignoriert Ereignisse, keine Fenster-Abfrage, keine Zeilen', async () => {
  let winCalls = 0;
  const { c, clock, store } = setup({
    routes: { 'GET /api/activity/state': { status: 200, json: { track: false, reason: 'off_shift', idleMin: 5, consentVersion: VERSION } } },
    win: async () => { winCalls++; return null; },
  });
  c.start();
  await clock.flush();
  c.onKey(); c.onMouse('down');
  await clock.advance(120000);
  assert.equal(winCalls, 0);
  assert.equal(store.get('_actBuf', []).length, 0);
  assert.equal(c.state().reason, 'off_shift');
  assert.equal(trayLabel(c.state().reason), 'Activity tracking: off (not clocked in)');
  c.stop();
});

test('controller: Wechsel auf break pausiert sofort, Zeilen nur für Minuten mit Tracking', async () => {
  let track = true;
  const { c, clock, store } = setup({
    routes: { 'GET /api/activity/state': () => ({ status: 200, json: { track, reason: track ? 'ok' : 'break', idleMin: 5, consentVersion: VERSION } }) },
  });
  c.start();
  await clock.flush();
  await clock.advance(29500); // 12:01:00 -> Zeile 12:00
  track = false;
  await clock.advance(30500); // State-Poll bei 12:01:30.5 -> break
  c.onKey();
  await clock.advance(120000);
  const rows = store.get('_actBuf', []);
  assert.deepEqual(rows.map((r) => r.minute), ['2026-11-09T12:00:00.000Z', '2026-11-09T12:01:00.000Z']);
  assert.equal(rows[1].keys, 0);
  assert.equal(c.state().reason, 'break');
  c.stop();
});

test('controller: alle 3 min senden, höchstens 600 Zeilen, bei 202 genau die gesendeten bestätigen', async () => {
  const old = Array.from({ length: 700 }, (_, i) => ({ minute: new Date(Date.parse('2026-11-08T00:00:00Z') + i * 60000).toISOString(), keys: 1, mouse: 0, site: null }));
  const store = memStore({ _act: 'tok', _actBuf: old });
  let sent = [];
  const { c, clock } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: false, reason: 'off_shift', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/minutes': (opts) => { sent.push(opts.body.minutes.length); return { status: 202, json: { stored: 1, dropped: 0 } }; },
    },
  });
  c.start();
  await clock.advance(179000);
  assert.deepEqual(sent, []);
  await clock.advance(1000);
  assert.deepEqual(sent, [600]);
  assert.equal(store.get('_actBuf').length, 100);
  assert.equal(store.get('_actBuf')[0].minute, old[600].minute);
  await clock.advance(180000);
  assert.deepEqual(sent, [600, 100]);
  assert.equal(store.get('_actBuf').length, 0);
  c.stop();
});

test('controller: Zeilen, die während des Sendens dazukommen, bleiben erhalten', async () => {
  const store = memStore({ _act: 'tok', _actBuf: [{ minute: '2026-11-09T11:00:00.000Z', keys: 1, mouse: 1, site: null }] });
  let release;
  const { c, clock } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/minutes': () => new Promise((r) => { release = () => r({ status: 202, json: { stored: 1, dropped: 0 } }); }),
    },
  });
  c.start();
  await clock.advance(180000); // 1 alte + 3 neue Zeilen, Senden (4 Zeilen) hängt
  assert.equal(store.get('_actBuf').length, 4);
  await clock.advance(60000); // während des Sendens kommt Zeile 12:03 dazu
  assert.equal(store.get('_actBuf').length, 5);
  release();
  await clock.flush();
  assert.equal(store.get('_actBuf').length, 1);
  assert.equal(store.get('_actBuf')[0].minute, '2026-11-09T12:03:00.000Z');
  c.stop();
});

test('controller: Senden 500 oder Netzfehler behält Puffer', async () => {
  const store = memStore({ _act: 'tok', _actBuf: [{ minute: '2026-11-09T11:00:00.000Z', keys: 1, mouse: 1, site: null }] });
  let n = 0;
  const { c, clock } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: false, reason: 'off_shift', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/minutes': () => (++n === 1 ? { status: 500, json: { error: 'server_error' } } : { status: 0, json: null }),
    },
  });
  c.start();
  await clock.advance(360000);
  assert.equal(n, 2);
  assert.equal(store.get('_actBuf').length, 1);
  assert.equal(store.get('_act'), 'tok');
  c.stop();
});

test('controller: Senden 403 stoppt Tracking, löscht Token und Puffer', async () => {
  const store = memStore({ _act: 'tok', _actBuf: [{ minute: '2026-11-09T11:00:00.000Z', keys: 1, mouse: 1, site: null }] });
  const { c, clock } = setup({
    store,
    routes: {
      // Wie der Server: ohne Token 401
      'GET /api/activity/state': (o) => (o.headers['x-activity-token'] ? { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } } : { status: 401, json: { error: 'unauthorized' } }),
      'POST /api/activity/minutes': { status: 403, json: { error: 'no_consent' } },
    },
  });
  c.start();
  await clock.advance(180000);
  assert.equal(store.get('_act'), null);
  assert.equal(store.get('_actBuf').length, 0);
  assert.equal(c.state().track, false);
  assert.equal(c.state().reason, 'no_consent');
  c.onKey();
  await clock.advance(120000);
  assert.equal(store.get('_actBuf').length, 0);
  c.stop();
});

test('controller: 413 halbiert die Sendemenge, eine einzelne zu große Zeile wird verworfen', async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ minute: new Date(Date.parse('2026-11-09T10:00:00Z') + i * 60000).toISOString(), keys: 0, mouse: 0, site: null }));
  const store = memStore({ _act: 'tok', _actBuf: rows });
  const sizes = [];
  const { c, clock } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: false, reason: 'off_shift', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/minutes': (o) => { sizes.push(o.body.minutes.length); return { status: 413, json: { error: 'too_large' } }; },
    },
  });
  c.start();
  await clock.advance(180000 * 4);
  assert.deepEqual(sizes, [4, 2, 1, 1]);
  assert.equal(store.get('_actBuf').length, 2);
  c.stop();
});

test('controller: state 401 löscht Token, 500 behält Token und Tracking, 404 = Feature aus, Re-Check nach 10 min', async () => {
  let resp = { status: 500, json: { error: 'server_error' } };
  const store = memStore({ _act: 'tok' });
  const { c, clock, http } = setup({ store, routes: { 'GET /api/activity/state': () => resp } });
  c.start();
  await clock.flush();
  assert.equal(store.get('_act'), 'tok');
  assert.equal(c.state().track, false); // noch nie bestätigt -> nicht tracken
  resp = { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } };
  await clock.advance(60000);
  assert.equal(c.state().track, true);
  resp = { status: 500, json: { error: 'server_error' } };
  await clock.advance(60000);
  assert.equal(c.state().track, true); // kurzer Serverfehler: weiter tracken
  assert.equal(store.get('_act'), 'tok');
  resp = { status: 404, json: { error: 'activity tracking off' } };
  await clock.advance(60000);
  assert.equal(c.state().track, false);
  assert.equal(c.state().reason, 'feature_off');
  const before = http.calls.filter((x) => x.path === '/api/activity/state').length;
  await clock.advance(9 * 60000);
  assert.equal(http.calls.filter((x) => x.path === '/api/activity/state').length, before);
  resp = { status: 401, json: { error: 'unauthorized' } };
  await clock.advance(60000);
  assert.equal(http.calls.filter((x) => x.path === '/api/activity/state').length, before + 1);
  assert.equal(store.get('_act'), null);
  assert.equal(c.state().reason, 'no_consent');
  c.stop();
});

test('controller: Serverfehler länger als 5 min -> status_unknown, Tracking aus', async () => {
  let resp = { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } };
  const { c, clock } = setup({ routes: { 'GET /api/activity/state': () => resp } });
  c.start();
  await clock.flush();
  resp = { status: 0, json: null };
  await clock.advance(4 * 60000);
  assert.equal(c.state().track, true);
  await clock.advance(2 * 60000);
  assert.equal(c.state().track, false);
  assert.equal(c.state().reason, 'status_unknown');
  c.stop();
});

test('controller: Token-Header und Mac-Berechtigungsheader beim State-Abruf', async () => {
  const { c, clock, http } = setup({ perm: () => 'no-accessibility' });
  c.start();
  await clock.flush();
  const call = http.calls.find((x) => x.path === '/api/activity/state');
  assert.equal(call.headers['x-activity-token'], 'tok');
  assert.equal(call.headers['x-activity-perm'], 'no-accessibility');
  c.stop();
});

test('controller: 3 native Fehler in Folge -> error, alles gestoppt; ein Erfolg setzt den Zähler zurück', async () => {
  let n = 0;
  const { c, clock, states } = setup({
    win: async () => { n++; if (n === 3) return null; throw new Error('native'); },
  });
  c.start();
  await clock.flush();
  await clock.advance(5000 * 4); // Fehler, Fehler, Erfolg, Fehler
  assert.equal(c.state().reason, 'ok');
  await clock.advance(5000 * 2); // Fehler, Fehler -> 3 in Folge
  assert.equal(c.state().reason, 'error');
  assert.equal(c.state().track, false);
  assert.equal(trayLabel('error'), 'Activity tracking: error');
  assert.equal(states[states.length - 1].reason, 'error');
  assert.deepEqual(clock.pending(), []);
  c.stop();
});

test('controller: startHooks wirft dreimal -> error', async () => {
  const { c, clock } = setup({ startHooks: () => { throw new Error('no uiohook'); } });
  c.start();
  await clock.flush();
  assert.equal(c.state().reason, 'ok');
  await clock.advance(120000);
  assert.equal(c.state().reason, 'error');
  c.stop();
});

test('controller: Einwilligung speichert Token und fragt sofort den Status ab', async () => {
  const store = memStore({ _actDeclined: '2026-01-01' });
  const { c, clock, http } = setup({
    store,
    routes: {
      'POST /api/activity/consent': { status: 200, json: { token: 'newtok' } },
      'GET /api/activity/state': { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } },
    },
  });
  c.start();
  await clock.flush();
  const r = await c.consent({ username: 'Anna', password: 'pw', decision: 'accepted', deviceId: 'dev1' });
  await clock.flush();
  assert.deepEqual(r, { ok: true });
  assert.equal(store.get('_act'), 'newtok');
  assert.equal(store.get('_actDeclined'), null);
  const body = http.calls.find((x) => x.path === '/api/activity/consent').body;
  assert.deepEqual(body, { username: 'Anna', password: 'pw', decision: 'accepted', textVersion: VERSION, deviceId: 'dev1' });
  assert.equal(c.state().track, true);
  c.stop();
});

test('controller: Einwilligungsfehler in Klartext', async () => {
  const map = [
    [{ status: 401, json: { error: 'invalid_credentials' } }, /wrong password/i],
    [{ status: 429, json: { error: 'too_many_attempts' } }, /too many attempts/i],
    [{ status: 502, json: { error: 'relay_unavailable' } }, /unreachable/i],
    [{ status: 0, json: null }, /unreachable/i],
    [{ status: 500, json: { error: 'server_error' } }, /unreachable/i],
    [{ status: 409, json: { error: 'not_mapped' } }, /not set up/i],
    [{ status: 400, json: { error: 'missing_credentials' } }, /password/i],
    [{ status: 400, json: { error: 'old_consent_version' } }, /update/i],
    [{ status: 404, json: { error: 'activity tracking off' } }, /turned off/i],
  ];
  for (const [resp, re] of map) assert.match(consentErrorMessage(resp), re);

  const { c, clock, store } = setup({ store: memStore({}), routes: { 'POST /api/activity/consent': { status: 401, json: { error: 'invalid_credentials' } } } });
  c.start();
  await clock.flush();
  const r = await c.consent({ username: 'Anna', password: 'bad', decision: 'accepted', deviceId: 'dev1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /wrong password/i);
  assert.equal(store.get('_act', null), null);
  const r2 = await c.consent({ username: 'Anna', password: '', decision: 'accepted', deviceId: 'dev1' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /password/i);
  c.stop();
});

test('controller: Ablehnen merkt die Version lokal, löscht Token, kein Tracking', async () => {
  const store = memStore({ _act: 'tok' });
  const { c, clock, http } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: false, reason: 'old_consent', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/consent': { status: 200, json: { ok: true } },
    },
  });
  c.start();
  await clock.flush();
  const r = await c.consent({ username: 'Anna', password: 'pw', decision: 'declined', deviceId: 'dev1' });
  assert.equal(r.ok, true);
  assert.equal(store.get('_actDeclined'), VERSION);
  assert.equal(store.get('_act'), null);
  assert.equal(c.state().reason, 'no_consent');
  assert.equal(http.calls.find((x) => x.path === '/api/activity/consent').body.decision, 'declined');
  // Ablehnen ohne Passwort klappt lokal, ohne Serveraufruf
  const r2 = await c.consent({ username: 'Anna', password: '', decision: 'declined', deviceId: 'dev1' });
  assert.equal(r2.ok, true);
  assert.equal(http.calls.filter((x) => x.path === '/api/activity/consent').length, 1);
  c.stop();
});

test('controller: Widerruf stoppt sofort, löscht Token und Puffer, auch wenn der Request scheitert', async () => {
  const store = memStore({ _act: 'tok' });
  const { c, clock, http } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/revoke': async () => { throw new Error('offline'); },
    },
  });
  c.start();
  await clock.flush();
  c.onKey();
  await clock.advance(29500);
  assert.equal(store.get('_actBuf').length, 1);
  const r = await c.revoke();
  assert.equal(r.ok, true);
  assert.equal(store.get('_act'), null);
  assert.equal(store.get('_actBuf').length, 0);
  assert.equal(store.get('_actDeclined'), VERSION);
  assert.equal(c.state().track, false);
  assert.equal(c.state().reason, 'no_consent');
  assert.equal(http.calls.find((x) => x.path === '/api/activity/revoke').headers['x-activity-token'], 'tok');
  c.onKey();
  await clock.advance(180000);
  assert.equal(store.get('_actBuf').length, 0);
  c.stop();
});

test('controller: stop() sichert die angefangene Minute und stoppt alle Timer', async () => {
  const { c, clock, store } = setup();
  c.start();
  await clock.flush();
  c.onKey();
  c.stop();
  assert.deepEqual(store.get('_actBuf'), [{ minute: '2026-11-09T12:00:00.000Z', keys: 1, mouse: 0, site: null }]);
  assert.deepEqual(clock.pending(), []);
});

test('shouldShowConsent: Regel', () => {
  const base = { loggedIn: true, reason: 'no_consent', declinedVersion: null, version: VERSION, shownThisRun: false };
  assert.equal(shouldShowConsent(base), true);
  assert.equal(shouldShowConsent({ ...base, reason: 'old_consent' }), true);
  assert.equal(shouldShowConsent({ ...base, loggedIn: false }), false);
  assert.equal(shouldShowConsent({ ...base, shownThisRun: true }), false);
  assert.equal(shouldShowConsent({ ...base, declinedVersion: VERSION }), false);
  assert.equal(shouldShowConsent({ ...base, declinedVersion: '2026-01-01' }), true);
  for (const reason of ['ok', 'off_shift', 'break', 'status_unknown', 'feature_off', 'error', 'starting']) {
    assert.equal(shouldShowConsent({ ...base, reason }), false, reason);
  }
});

test('trayLabel: Texte', () => {
  assert.equal(trayLabel('ok'), 'Activity tracking: on');
  assert.equal(trayLabel('off_shift'), 'Activity tracking: off (not clocked in)');
  assert.equal(trayLabel('break'), 'Activity tracking: off (break)');
  assert.equal(trayLabel('no_consent'), 'Activity tracking: no consent');
  assert.equal(trayLabel('old_consent'), 'Activity tracking: no consent');
});

test('controller: ohne laufende Hooks (z. B. Mac ohne Bedienungshilfen) keine Null-Zeilen', async () => {
  let allowed = false;
  const { c, clock, store } = setup({ startHooks: () => allowed });
  c.start();
  await clock.flush();
  assert.equal(c.state().track, true);
  await clock.advance(29500 + 60000); // zwei Minutengrenzen ohne Hooks
  assert.equal(store.get('_actBuf', []).length, 0);
  allowed = true;
  await clock.advance(30500); // State-Poll 12:02:30.5 startet die Hooks
  c.onKey();
  await clock.advance(29500); // Grenze 12:03:00
  assert.deepEqual(store.get('_actBuf').map((r) => [r.minute, r.keys]), [['2026-11-09T12:02:00.000Z', 1]]);
  c.stop();
});

test('controller: Widerruf und Ablehnen stoppen die OS-Hooks, track=true startet sie wieder', async () => {
  const store = memStore({ _act: 'tok', _actOwner: 'anna' });
  const { c, clock, native } = setup({
    store,
    routes: {
      'GET /api/activity/state': { status: 200, json: { track: true, reason: 'ok', idleMin: 5, consentVersion: VERSION } },
      'POST /api/activity/consent': { status: 200, json: { token: 'tok2' } },
      'POST /api/activity/revoke': { status: 200, json: { ok: true } },
    },
  });
  c.start();
  await clock.flush();
  assert.equal(native.hookStarts, 1);
  await c.revoke();
  assert.equal(native.hookStops, 1);
  await c.consent({ username: 'anna', password: 'pw', decision: 'accepted', deviceId: 'd' });
  await clock.flush();
  assert.equal(c.state().track, true);
  assert.equal(native.hookStarts, 2);
  await c.consent({ username: 'anna', password: '', decision: 'declined', deviceId: 'd' });
  assert.equal(native.hookStops, 2);
  c.stop();
});

test('controller: Token gehört dem Nutzer; anderer Login löscht Token und Puffer, Widerruf best effort', async () => {
  const store = memStore({ _act: 'tok', _actOwner: 'anna', _actBuf: [{ minute: '2026-11-09T11:00:00.000Z', keys: 1, mouse: 0, site: null }] });
  const { c, http } = setup({ store, routes: { 'POST /api/activity/revoke': async () => { throw new Error('offline'); } } });
  await c.bindUser('Anna');
  assert.equal(store.get('_act'), 'tok'); // gleicher Nutzer (Groß/klein egal)
  await c.bindUser('bob');
  assert.equal(store.get('_act'), null);
  assert.equal(store.get('_actOwner'), null);
  assert.equal(store.get('_actBuf').length, 0);
  assert.equal(store.get('_actDeclined', null), null); // Bob wird gefragt, nicht als abgelehnt markiert
  assert.equal(http.calls.find((x) => x.path === '/api/activity/revoke').headers['x-activity-token'], 'tok');
  // Token ohne Besitzer gilt als fremd
  store.set('_act', 'orphan');
  await c.bindUser('bob');
  assert.equal(store.get('_act'), null);
  // Leerer Nutzer (nicht eingeloggt): nichts tun
  store.set('_act', 'tok3'); store.set('_actOwner', 'carl');
  await c.bindUser('');
  assert.equal(store.get('_act'), 'tok3');
});

test('controller: Einwilligung speichert den Besitzer des Tokens', async () => {
  const store = memStore({});
  const { c, clock } = setup({ store, routes: { 'POST /api/activity/consent': { status: 200, json: { token: 't' } } } });
  c.start();
  await clock.flush();
  await c.consent({ username: 'Anna', password: 'pw', decision: 'accepted', deviceId: 'd' });
  assert.equal(store.get('_actOwner'), 'anna');
  c.stop();
});
