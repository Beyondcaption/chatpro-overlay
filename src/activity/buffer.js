// Offline-Puffer fuer Minutenzeilen. Persistenz ueber injizierte load/save.
function createBuffer({ load, save, max = 10080 } = {}) {
  let rows = [];
  try {
    const stored = load && load();
    if (Array.isArray(stored)) rows = stored.slice(-max);
  } catch (e) {
    rows = [];
  }

  function persist() {
    try { save && save(rows.slice()); } catch (e) { /* Persistenz ist best effort */ }
  }

  return {
    push(newRows) {
      const add = Array.isArray(newRows) ? newRows : [newRows];
      rows = rows.concat(add);
      if (rows.length > max) rows = rows.slice(rows.length - max);
      persist();
    },
    take(n) { return rows.slice(0, n); },
    ack(n) {
      rows = rows.slice(Math.max(0, n));
      persist();
    },
    size() { return rows.length; },
  };
}

module.exports = { createBuffer };
