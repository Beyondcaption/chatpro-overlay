// Minuten-Aggregator: zaehlt Tasten/Mausereignisse und die haeufigste Seite pro Minute.
function createAggregator() {
  let keys = 0;
  let mouse = 0;
  let samples = []; // in Reihenfolge

  return {
    key() { keys++; },
    mouse() { mouse++; },
    sample(site) { if (site) samples.push(site); },
    flush(minuteIso) {
      const counts = new Map();
      const last = new Map();
      samples.forEach((s, i) => {
        counts.set(s, (counts.get(s) || 0) + 1);
        last.set(s, i);
      });
      let site = null;
      let best = 0;
      let bestLast = -1;
      for (const [s, n] of counts) {
        const l = last.get(s);
        if (n > best || (n === best && l > bestLast)) { site = s; best = n; bestLast = l; }
      }
      const row = { minute: minuteIso, keys, mouse, site };
      keys = 0;
      mouse = 0;
      samples = [];
      return row;
    },
  };
}

module.exports = { createAggregator };
