// Entscheidungslogik des Aktivitaets-Trackers, ohne Electron und ohne native Module.
// Uhr, Timer, HTTP, Store und native Funktionen werden injiziert (testbar mit node:test).
const { createAggregator } = require('./aggregate');
const { createBuffer } = require('./buffer');
const { classifySite } = require('./site');

const MIN = 60000;
const STATE_MS = 60000;          // Status-Abfrage
const FEATURE_OFF_MS = 10 * MIN; // Re-Check wenn das Feature serverseitig aus ist
const WINDOW_MS = 5000;          // aktives Fenster abfragen
const SEND_MS = 3 * MIN;         // Minuten senden
const MAX_SEND = 600;
const MOVE_MS = 500;             // mousemove hoechstens 1 Zaehlung je 500 ms
const STALE_MS = 15 * MIN;       // so lange ohne Serverantwort weiter tracken (Offline-Puffer)
const MAX_NATIVE_FAIL = 3;

const KEY_TOKEN = '_act';
const KEY_BUF = '_actBuf';
const KEY_DECLINED = '_actDeclined';

const LABELS = {
  ok: 'Activity tracking: on',
  off_shift: 'Activity tracking: off (not clocked in)',
  break: 'Activity tracking: off (break)',
  no_consent: 'Activity tracking: no consent',
  old_consent: 'Activity tracking: no consent',
  status_unknown: 'Activity tracking: off (status unknown)',
  feature_off: 'Activity tracking: off',
  error: 'Activity tracking: error',
  starting: 'Activity tracking: starting',
};

function trayLabel(reason) {
  return LABELS[reason] || 'Activity tracking: off';
}

function msUntilNextMinute(t) {
  const r = MIN - (t % MIN);
  return r <= 0 ? MIN : r;
}

function shouldShowConsent({ loggedIn, reason, declinedVersion, version, shownThisRun } = {}) {
  if (!loggedIn || shownThisRun) return false;
  if (reason !== 'no_consent' && reason !== 'old_consent') return false;
  return declinedVersion !== version;
}

function consentErrorMessage(r) {
  const status = r && r.status;
  const err = r && r.json && r.json.error;
  if (status === 401) return 'Wrong password. Please try again.';
  if (status === 429) return 'Too many attempts. Please wait 15 minutes and try again.';
  if (status === 409) return 'Your account is not set up for activity tracking yet. Please contact your team leader.';
  if (status === 404) return 'Activity tracking is currently turned off.';
  if (status === 400 && err === 'old_consent_version') return 'This ChatPro version is out of date. Please update ChatPro and try again.';
  if (status === 400 && err === 'missing_credentials') return 'Please enter your ChatPro password.';
  if (status === 400) return 'The request was rejected. Please update ChatPro and try again.';
  return 'Server unreachable. Please check your internet connection and try again later.';
}

function createController({
  store, http, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  consentVersion, native = {}, classify = classifySite, permHeader = () => null, onState = () => {},
}) {
  const buf = createBuffer({ load: () => store.get(KEY_BUF, []), save: (rows) => store.set(KEY_BUF, rows) });
  let agg = createAggregator();
  let minuteStart = Math.floor(now() / MIN) * MIN;
  let activeThisMinute = false;
  let tracking = false;
  let reason = 'starting';
  let running = false;
  let errored = false;
  let hooksStarted = false;
  let lastMove = -Infinity;
  let lastStateOk = 0;
  let featureOff = false;
  let sending = false;
  let sendMax = MAX_SEND;
  let epoch = 0; // steigt bei jedem Token-Wechsel; spaete Antworten zum alten Token werden verworfen
  const fails = { hooks: 0, win: 0 };
  const timers = {};
  let lastEmitted = '';

  const token = () => store.get(KEY_TOKEN, null) || null;

  function safe(fn) {
    try {
      const p = fn();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* Tracker-Fehler duerfen das Overlay nie stoeren */ }
  }
  function arm(name, ms, fn) {
    disarm(name);
    if (!running || errored) return;
    timers[name] = setTimer(() => { delete timers[name]; safe(fn); }, ms);
  }
  function disarm(name) {
    if (timers[name] !== undefined) { try { clearTimer(timers[name]); } catch (e) {} delete timers[name]; }
  }
  function disarmAll() { Object.keys(timers).forEach(disarm); }

  function state() {
    return { track: tracking, reason, label: trayLabel(reason), consentVersion };
  }
  function emit() {
    const s = state();
    const sig = s.track + '|' + s.reason;
    if (sig === lastEmitted) return;
    lastEmitted = sig;
    try { onState(s); } catch (e) {}
  }

  function setTrack(track, why) {
    if (errored) return;
    track = !!track;
    if (track && !tracking) {
      tracking = true;
      if (hooksStarted) activeThisMinute = true;
      arm('win', WINDOW_MS, winTick);
    } else if (!track && tracking) {
      tracking = false;
      disarm('win');
    }
    reason = why;
    if (tracking) ensureHooks();
    emit();
  }

  function nativeFail(kind) {
    fails[kind]++;
    if (fails[kind] >= MAX_NATIVE_FAIL) enterError();
  }
  function enterError() {
    if (errored) return;
    tracking = false;
    reason = 'error';
    errored = true;
    disarmAll();
    try { native.stopHooks && native.stopHooks(); } catch (e) {}
    hooksStarted = false;
    emit();
  }

  function ensureHooks() {
    if (hooksStarted || errored || !native.startHooks) return;
    try {
      const ok = native.startHooks();
      if (ok !== false) {
        hooksStarted = true;
        fails.hooks = 0;
        if (tracking) activeThisMinute = true; // Zeilen erst, wenn Eingaben wirklich gezaehlt werden
      }
    } catch (e) {
      nativeFail('hooks');
    }
  }

  function resetMinute() {
    agg = createAggregator();
    activeThisMinute = tracking && hooksStarted;
    minuteStart = Math.floor(now() / MIN) * MIN;
  }

  function clearConsent(why = 'no_consent') {
    epoch++;
    try { store.set(KEY_TOKEN, null); } catch (e) {}
    buf.ack(buf.size());
    tracking = false;
    disarm('win');
    resetMinute();
    activeThisMinute = false;
    lastStateOk = 0;
    if (errored) return;
    reason = why;
    emit();
  }

  // --- Ereignisse aus den nativen Hooks ---
  function onKey() {
    if (tracking) agg.key();
  }
  function onMouse(kind) {
    if (!tracking) return;
    if (kind === 'move') {
      const t = now();
      if (t - lastMove < MOVE_MS) return;
      lastMove = t;
    }
    agg.mouse();
  }

  // --- Timer ---
  function minuteTick() {
    if (activeThisMinute) buf.push(agg.flush(new Date(minuteStart).toISOString()));
    resetMinute();
    arm('minute', msUntilNextMinute(now()), minuteTick);
  }

  async function winTick() {
    if (!tracking) return;
    arm('win', WINDOW_MS, winTick);
    let w;
    try {
      w = native.activeWindow ? await native.activeWindow() : null;
    } catch (e) {
      nativeFail('win');
      return;
    }
    fails.win = 0;
    if (!tracking || !w) return;
    const site = classify({ appName: w.appName, title: w.title, url: w.url });
    if (site) agg.sample(site);
  }

  async function stateTick() {
    if (!running || errored) return;
    const tok = token();
    if (!tok) {
      featureOff = false;
      setTrack(false, 'no_consent');
      arm('state', STATE_MS, stateTick);
      return;
    }
    const my = epoch;
    const headers = { 'x-activity-token': tok };
    try { const p = permHeader(); if (p) headers['x-activity-perm'] = p; } catch (e) {}
    let r;
    try { r = await http('GET', '/api/activity/state', { headers }); } catch (e) { r = { status: 0, json: null }; }
    if (!running || errored || my !== epoch) return;
    const status = r && r.status;
    if (status === 404) {
      featureOff = true;
      setTrack(false, 'feature_off');
      arm('state', FEATURE_OFF_MS, stateTick);
      return;
    }
    featureOff = false;
    if (status === 401) {
      clearConsent('no_consent');
    } else if (status === 200 && r.json && typeof r.json === 'object') {
      lastStateOk = now();
      const j = r.json;
      setTrack(j.track === true, j.track === true ? 'ok' : String(j.reason || 'status_unknown'));
    } else if (!lastStateOk || now() - lastStateOk > STALE_MS) {
      // Noch nie bestaetigt oder zu lange ohne Antwort: nicht (weiter) tracken.
      setTrack(false, 'status_unknown');
    } else if (tracking) {
      ensureHooks();
    }
    arm('state', STATE_MS, stateTick);
  }

  async function sendTick() {
    arm('send', SEND_MS, sendTick);
    const tok = token();
    if (sending || !tok || featureOff || errored) return;
    const rows = buf.take(sendMax);
    if (!rows.length) return;
    const my = epoch;
    sending = true;
    let r;
    try {
      r = await http('POST', '/api/activity/minutes', { headers: { 'x-activity-token': tok }, body: { minutes: rows } });
    } catch (e) {
      r = { status: 0, json: null };
    } finally {
      sending = false;
    }
    if (my !== epoch) return; // Token wurde inzwischen widerrufen oder ersetzt
    const status = r && r.status;
    if (status === 202) {
      buf.ack(rows.length);
      sendMax = MAX_SEND;
    } else if (status === 403 || status === 401) {
      clearConsent('no_consent');
    } else if (status === 404) {
      featureOff = true;
      setTrack(false, 'feature_off');
    } else if (status === 413) {
      if (rows.length <= 1) buf.ack(1); // eine einzelne Zeile ist zu gross: verwerfen
      else sendMax = Math.ceil(rows.length / 2);
    }
    // 500 / Netzfehler: Puffer behalten, beim naechsten Mal erneut
  }

  // --- Oeffentliche API ---
  function start() {
    if (running) return;
    running = true;
    resetMinute();
    arm('minute', msUntilNextMinute(now()), minuteTick);
    arm('send', SEND_MS, sendTick);
    safe(stateTick);
  }

  function refresh() {
    disarm('state');
    return stateTick().catch(() => {});
  }

  function stop() {
    if (activeThisMinute && running && !errored) {
      try { buf.push(agg.flush(new Date(minuteStart).toISOString())); } catch (e) {}
    }
    activeThisMinute = false;
    running = false;
    tracking = false;
    disarmAll();
    try { native.stopHooks && native.stopHooks(); } catch (e) {}
    hooksStarted = false;
  }

  async function consent({ username, password, decision, deviceId } = {}) {
    try {
      if (decision === 'declined') {
        try { store.set(KEY_DECLINED, consentVersion); } catch (e) {}
        clearConsent('no_consent');
        if (username && password && deviceId) {
          try {
            await http('POST', '/api/activity/consent', { body: { username, password, decision: 'declined', textVersion: consentVersion, deviceId } });
          } catch (e) { /* Ablehnen gilt lokal immer */ }
        }
        return { ok: true };
      }
      if (decision !== 'accepted') return { ok: false, error: 'Unknown choice.' };
      if (!username) return { ok: false, error: 'Please log in to ChatPro first.' };
      if (!password) return { ok: false, error: 'Please enter your ChatPro password.' };
      if (!deviceId) return { ok: false, error: 'This device could not be identified. Please restart ChatPro.' };
      let r;
      try {
        r = await http('POST', '/api/activity/consent', { body: { username, password, decision: 'accepted', textVersion: consentVersion, deviceId } });
      } catch (e) {
        r = { status: 0, json: null };
      }
      if (r && r.status === 200 && r.json && typeof r.json.token === 'string' && r.json.token) {
        epoch++;
        store.set(KEY_TOKEN, r.json.token);
        try { store.set(KEY_DECLINED, null); } catch (e) {}
        lastStateOk = 0;
        featureOff = false;
        if (running) await refresh();
        return { ok: true };
      }
      return { ok: false, error: consentErrorMessage(r) };
    } catch (e) {
      return { ok: false, error: consentErrorMessage(null) };
    }
  }

  async function revoke() {
    const tok = token();
    try { store.set(KEY_DECLINED, consentVersion); } catch (e) {}
    clearConsent('no_consent');
    if (tok) {
      try { await http('POST', '/api/activity/revoke', { headers: { 'x-activity-token': tok } }); } catch (e) { /* lokal bereits gestoppt */ }
    }
    return { ok: true };
  }

  // Native Module fehlen: Tracker aus (Status "error"), Widerruf funktioniert weiter.
  function disable() { enterError(); }

  return { start, stop, state, refresh, onKey, onMouse, consent, revoke, disable };
}

module.exports = {
  createController, shouldShowConsent, trayLabel, consentErrorMessage, msUntilNextMinute,
  KEY_TOKEN, KEY_BUF, KEY_DECLINED,
};
