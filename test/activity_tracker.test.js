const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startTracker, makeHttp } = require('../src/activity/tracker');

function memStore(init = {}) {
  const d = { ...init };
  return { d, get: (k, def) => (d[k] !== undefined ? d[k] : def), set: (k, v) => { d[k] = v; } };
}

test('tracker: fehlendes natives Modul -> Status error, kein Request, Widerruf geht trotzdem', async () => {
  const store = memStore({ _act: 'tok' });
  const states = [];
  const t = startTracker({
    opsUrl: 'http://127.0.0.1:9', deviceHeaders: {}, store, consentVersion: '2026-11-09',
    onState: (s) => states.push(s), _native: { uIOhook: null, activeWin: null },
  });
  assert.equal(t.state().reason, 'error');
  assert.equal(t.state().label, 'Activity tracking: error');
  assert.equal(states[0].reason, 'error');
  const r = await t.revoke();
  assert.equal(r.ok, true);
  assert.equal(store.get('_act'), null);
  t.stop();
});

test('tracker: Hooks werden verdrahtet, Ereignisse landen im Controller', async () => {
  const handlers = {};
  let starts = 0;
  const uIOhook = { on: (ev, fn) => { handlers[ev] = fn; }, start: () => { starts++; }, stop: () => {} };
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ track: true, reason: 'ok', idleMin: 5, consentVersion: '2026-11-09' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const store = memStore({ _act: 'tok' });
  const t = startTracker({
    opsUrl: 'http://127.0.0.1:' + server.address().port, deviceHeaders: {}, store, consentVersion: '2026-11-09',
    onState: () => {}, _native: { uIOhook, activeWin: async () => ({ owner: { name: 'Discord' }, title: 'x' }) },
  });
  for (let i = 0; i < 50 && t.state().reason !== 'ok'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.state().track, true);
  assert.equal(starts, 1);
  assert.deepEqual(Object.keys(handlers).sort(), ['keydown', 'mousedown', 'mousemove', 'wheel']);
  handlers.keydown(); handlers.mousedown();
  t.stop(); // sichert die angefangene Minute
  const rows = store.get('_actBuf');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].keys, 1);
  assert.equal(rows[0].mouse, 1);
  server.close();
});

test('makeHttp: JSON hin und zurück, Geräte- und Token-Header, Netzfehler -> status 0', async () => {
  let seen;
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body: b };
      res.statusCode = 202;
      res.end(JSON.stringify({ stored: 2, dropped: 0 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const h = makeHttp('http://127.0.0.1:' + server.address().port, { 'x-device-id': 'dev1' });
  const r = await h('POST', '/api/activity/minutes', { headers: { 'x-activity-token': 'tok' }, body: { minutes: [1, 2] } });
  assert.deepEqual(r, { status: 202, json: { stored: 2, dropped: 0 } });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/activity/minutes');
  assert.equal(seen.headers['x-device-id'], 'dev1');
  assert.equal(seen.headers['x-activity-token'], 'tok');
  assert.deepEqual(JSON.parse(seen.body), { minutes: [1, 2] });
  server.close();
  const bad = await makeHttp('http://127.0.0.1:9', {})('GET', '/x');
  assert.equal(bad.status, 0);
});
