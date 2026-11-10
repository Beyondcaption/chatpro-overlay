const { test } = require('node:test');
const assert = require('node:assert');
const { createLivePoller } = require('../src/activity/livepoll');

const tick = () => new Promise((r) => setImmediate(r));

// Fake-Uhr: advance() führt fällige Timer aus und lässt Promises laufen.
function fakeClock(start = 1000000) {
  let t = start; let seq = 0; const q = new Map();
  return {
    now: () => t,
    setTimer(fn, ms) { const id = ++seq; q.set(id, { at: t + Math.max(0, ms), fn, id }); return id; },
    clearTimer(id) { q.delete(id); },
    pending: () => q.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        for (let i = 0; i < 6; i++) await tick();
        const due = [...q.values()].filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        q.delete(due.id); t = due.at; due.fn();
      }
      t = end;
      for (let i = 0; i < 6; i++) await tick();
    },
  };
}

function setup({ pollReplies = [], signalReplies = [], offer } = {}) {
  const clock = fakeClock();
  const calls = [];
  const banners = [];
  const cap = { begun: [], remote: [], stops: 0, offer: offer === undefined ? { sdp: 'OFFER', candidates: [{ c: 1 }] } : offer };
  const polls = [...pollReplies]; const sigs = [...signalReplies];
  const http = async (method, path, opts) => {
    calls.push({ method, path, body: opts && opts.body });
    if (path.startsWith('/api/activity/live/poll')) return { status: 200, json: polls.length ? polls.shift() : { session: null } };
    if (path.startsWith('/api/activity/live/offer')) return { status: 200, json: { ok: true } };
    if (path.startsWith('/api/activity/live/overlay-signal')) {
      return { status: 200, json: sigs.length ? sigs.shift() : { offer: 'OFFER', answer: null, candidates: [], nextCursor: 0, ended: null } };
    }
    return { status: 404, json: null };
  };
  const capture = {
    begin: async (s) => { cap.begun.push(s); return cap.offer; },
    remote: (r) => { cap.remote.push(r); },
    stop: () => { cap.stops++; },
  };
  const poller = createLivePoller({
    http, capture, onBanner: (b) => banners.push(b),
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, pollMs: 2000,
  });
  return { clock, calls, banners, cap, poller };
}

const S1 = { session: { id: 's1', iceServers: [] } };

test('poller starts capture and sends an offer when a session is pending', async () => {
  const t = setup({ pollReplies: [S1] });
  t.poller.start();
  await t.clock.advance(50);
  assert.deepStrictEqual(t.cap.begun, [{ id: 's1', iceServers: [] }]);
  const offer = t.calls.find((c) => c.method === 'POST' && c.path === '/api/activity/live/offer');
  assert.ok(offer);
  assert.deepStrictEqual(offer.body, { sessionId: 's1', sdp: 'OFFER', candidates: [{ c: 1 }] });
  assert.strictEqual(t.banners[0].active, true);
  t.poller.stop();
});

test('poller forwards answer once and candidates incrementally via cursor', async () => {
  const t = setup({
    pollReplies: [S1],
    signalReplies: [
      { answer: 'ANS', candidates: [{ a: 1 }], nextCursor: 1, ended: null },
      { answer: 'ANS', candidates: [{ a: 2 }], nextCursor: 2, ended: null },
    ],
  });
  t.poller.start();
  await t.clock.advance(5000);
  assert.deepStrictEqual(t.cap.remote[0], { answer: 'ANS', candidates: [{ a: 1 }] });
  assert.deepStrictEqual(t.cap.remote[1], { answer: null, candidates: [{ a: 2 }] });
  const sigs = t.calls.filter((c) => c.path.startsWith('/api/activity/live/overlay-signal'));
  assert.ok(sigs[0].path.includes('cursor=0'));
  assert.ok(sigs[1].path.includes('cursor=1'));
  t.poller.stop();
});

test('late overlay candidates are posted without sdp', async () => {
  const t = setup({ pollReplies: [S1] });
  t.poller.start();
  await t.clock.advance(50);
  t.poller.candidate({ late: 1 });
  await t.clock.advance(50);
  const posts = t.calls.filter((c) => c.method === 'POST');
  assert.deepStrictEqual(posts[1].body, { sessionId: 's1', sdp: null, candidates: [{ late: 1 }] });
  t.poller.stop();
});

test('poller ends and hides banner when signal reports ended', async () => {
  const t = setup({
    pollReplies: [S1],
    signalReplies: [{ ended: 'viewer_closed', candidates: [], nextCursor: 0 }],
  });
  t.poller.start();
  await t.clock.advance(5000);
  assert.strictEqual(t.cap.stops, 1);
  assert.deepStrictEqual(t.banners[t.banners.length - 1], { active: false });
  t.poller.stop();
});

test('poller ends the session on a local capture error', async () => {
  const t = setup({ pollReplies: [S1], offer: null });
  t.poller.start();
  await t.clock.advance(50);
  assert.strictEqual(t.cap.stops, 1);
  assert.deepStrictEqual(t.banners[t.banners.length - 1], { active: false });
  t.poller.stop();
});

test('poller stops cleanly on stop() mid-session and is idempotent', async () => {
  const t = setup({ pollReplies: [S1] });
  t.poller.start();
  await t.clock.advance(50);
  t.poller.stop();
  assert.strictEqual(t.cap.stops, 1);
  assert.deepStrictEqual(t.banners[t.banners.length - 1], { active: false });
  assert.strictEqual(t.clock.pending(), 0);
  t.poller.stop();
  assert.strictEqual(t.cap.stops, 1);
  const n = t.calls.length;
  await t.clock.advance(10000);
  assert.strictEqual(t.calls.length, n);
});

test('stop() during an in-flight begin closes the capture and sends no offer', async () => {
  const t = setup({ pollReplies: [S1] });
  let release;
  const gate = new Promise((r) => { release = r; });
  const capture = { begin: async () => { await gate; return { sdp: 'OFFER', candidates: [] }; }, remote() {}, stop: () => { t.cap.stops++; } };
  const poller = createLivePoller({
    http: async (m, p, o) => { t.calls.push({ method: m, path: p, body: o && o.body }); return { status: 200, json: p.startsWith('/api/activity/live/poll') ? S1 : { ok: true } }; },
    capture, onBanner: () => true, now: t.clock.now, setTimer: t.clock.setTimer, clearTimer: t.clock.clearTimer,
  });
  poller.start();
  await t.clock.advance(50);
  poller.stop();
  release();
  await t.clock.advance(50);
  assert.ok(t.cap.stops >= 2);
  assert.strictEqual(t.calls.filter((c) => c.path === '/api/activity/live/offer').length, 0);
});

test('a session that failed locally is not re-begun on the next tick', async () => {
  const t = setup({ pollReplies: [S1, S1, S1], offer: null });
  t.poller.start();
  await t.clock.advance(7000);
  assert.strictEqual(t.cap.begun.length, 1);
  t.poller.stop();
});

test('banner failure is fail-closed: no capture, no offer', async () => {
  const clock = fakeClock();
  const calls = []; let begun = 0; let stops = 0;
  const poller = createLivePoller({
    http: async (m, p) => { calls.push({ method: m, path: p }); return { status: 200, json: p.startsWith('/api/activity/live/poll') ? S1 : { ok: true } }; },
    capture: { begin: async () => { begun++; return { sdp: 'X', candidates: [] }; }, remote() {}, stop: () => { stops++; } },
    onBanner: (b) => { if (b.active) throw new Error('no window'); },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  poller.start();
  await clock.advance(50);
  assert.strictEqual(begun, 0);
  assert.strictEqual(calls.filter((c) => c.method === 'POST').length, 0);
  assert.strictEqual(stops, 1);
  poller.stop();
});

test('a non-finite nextCursor keeps the previous cursor', async () => {
  const t = setup({
    pollReplies: [S1],
    signalReplies: [{ candidates: [], nextCursor: 3 }, { candidates: [], nextCursor: 'x' }, { candidates: [], nextCursor: 3 }],
  });
  t.poller.start();
  await t.clock.advance(7000);
  const sigs = t.calls.filter((c) => c.path.startsWith('/api/activity/live/overlay-signal'));
  assert.ok(sigs[1].path.includes('cursor=3') && sigs[2].path.includes('cursor=3'));
  t.poller.stop();
});
