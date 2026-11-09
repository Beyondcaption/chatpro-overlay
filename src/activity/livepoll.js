// Live-Ansicht, Overlay-Seite: reine Poll- und Signalisierungslogik ohne Electron und ohne I/O.
// http, capture, onBanner und Timer werden injiziert (testbar mit node:test).
const P_POLL = '/api/activity/live/poll';
const P_OFFER = '/api/activity/live/offer';
const P_SIGNAL = '/api/activity/live/overlay-signal';
const HARD_LIMIT_MS = 30 * 60000; // Hartlimit je Sitzung
const COOLDOWN_MS = 60000;        // lokal beendete Sitzungs-IDs nicht sofort neu beginnen
const MAX_SIGNAL_FAIL = 15;       // aufeinanderfolgende Fehler, dann Sitzung beenden

function createLivePoller({ http, capture, onBanner, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, pollMs = 2000 } = {}) {
  let running = false;
  let timer = null;
  let gen = 0;        // Generationszähler gegen Rennen zwischen stop() und laufenden Anfragen
  const cooldown = new Map(); // id -> Zeitpunkt, bis zu dem die ID übersprungen wird
  let session = null; // { id, cursor, startedAt, offered, queued, fails, answered }

  const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const banner = (b) => safe(() => onBanner && onBanner(b));

  function endSession() {
    if (!session) return;
    cooldown.set(session.id, now() + COOLDOWN_MS);
    session = null;
    safe(() => capture.stop());
    banner({ active: false });
  }

  function schedule() {
    if (!running) return;
    timer = setTimer(() => { timer = null; tick(); }, pollMs);
  }

  async function beginSession(s) {
    const mine = { id: s.id, cursor: 0, startedAt: now(), offered: false, queued: [], fails: 0, answered: false };
    // Eine neue Sitzung beendet zuerst die vorherige.
    if (session) endSession();
    session = mine;
    // Hinweis zuerst, dann erst die Bildschirmaufnahme.
    // Fail-closed: ohne sichtbaren Hinweis keine Aufnahme (false oder Fehler = nicht gezeigt).
    let shown = false;
    try { shown = onBanner ? onBanner({ active: true, viewer: s.viewer }) !== false : false; } catch (e) { shown = false; }
    if (!shown) { endSession(); return; }
    let offer = null;
    try { offer = await capture.begin({ id: s.id, iceServers: s.iceServers || [] }); } catch (e) { offer = null; }
    // Inzwischen beendet: Aufnahme sicher schließen, auch wenn capture.begin erst jetzt zurückkam.
    if (session !== mine) { if (!session) safe(() => capture.stop()); return; }
    if (!offer || typeof offer.sdp !== 'string' || !offer.sdp) { endSession(); return; }
    const r = await http('POST', P_OFFER, { body: { sessionId: mine.id, sdp: offer.sdp, candidates: offer.candidates || [] } });
    if (session !== mine) return;
    if (!r || r.status !== 200) { endSession(); return; }
    mine.offered = true;
    if (mine.queued.length) {
      const c = mine.queued; mine.queued = [];
      try { await http('POST', P_OFFER, { body: { sessionId: mine.id, sdp: null, candidates: c } }); } catch (e) {}
    }
  }

  async function signalTick() {
    const cur = session;
    if (now() - cur.startedAt > HARD_LIMIT_MS) { endSession(); return; }
    if (!cur.offered) return;
    const r = await http('GET', `${P_SIGNAL}?sessionId=${encodeURIComponent(cur.id)}&cursor=${cur.cursor}`);
    if (session !== cur) return;
    if (!r || r.status !== 200 || !r.json) {
      if (++cur.fails >= MAX_SIGNAL_FAIL) endSession();
      return;
    }
    cur.fails = 0;
    const j = r.json;
    if (j.ended) { endSession(); return; }
    const cands = Array.isArray(j.candidates) ? j.candidates : [];
    if (Number.isFinite(j.nextCursor)) cur.cursor = j.nextCursor;
    const answer = typeof j.answer === 'string' && j.answer && !cur.answered ? j.answer : null;
    if (answer || cands.length) {
      if (answer) cur.answered = true;
      safe(() => capture.remote({ answer, candidates: cands }));
    }
  }

  async function tick() {
    if (!running) return;
    const g = gen;
    try {
      if (session) {
        await signalTick();
      } else {
        const r = await http('GET', P_POLL);
        for (const [k, until] of cooldown) if (until <= now()) cooldown.delete(k);
        const sid = r && r.status === 200 && r.json && r.json.session && r.json.session.id;
        if (g === gen && running && !session && sid && !cooldown.has(sid)) {
          await beginSession(r.json.session);
        }
      }
    } catch (e) {
      endSession(); // lokaler Fehler beendet die Sitzung, nie den Poller
    }
    if (g === gen) schedule();
  }

  return {
    start() {
      if (running) return;
      running = true;
      gen++;
      tick();
    },
    stop() {
      running = false;
      gen++;
      if (timer != null) { clearTimer(timer); timer = null; }
      endSession();
    },
    // Späte ICE-Kandidaten der Overlay-Seite: sdp-los an /live/offer (der Server erlaubt das).
    candidate(c) {
      const cur = session;
      if (!cur || c == null) return;
      if (!cur.offered) { cur.queued.push(c); return; }
      safe(() => Promise.resolve(http('POST', P_OFFER, { body: { sessionId: cur.id, sdp: null, candidates: [c] } })).catch(() => {}));
    },
  };
}

module.exports = { createLivePoller };
