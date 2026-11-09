const { test } = require('node:test');
const assert = require('node:assert');
const { createBuffer } = require('../src/activity/buffer');

function mem(initial) {
  const s = { data: initial, saves: 0 };
  return { s, load: () => s.data, save: (a) => { s.data = a.slice(); s.saves++; } };
}

test('buffer: Überlauf verwirft die ältesten, take/ack entfernt nur bestätigte', () => {
  const m = mem(undefined);
  const b = createBuffer({ load: m.load, save: m.save, max: 3 });
  b.push([{ n: 1, minute: 'm' }, { n: 2, minute: 'm' }]);
  b.push([{ n: 3, minute: 'm' }, { n: 4, minute: 'm' }]);
  assert.equal(b.size(), 3);
  assert.deepEqual(b.take(10).map((r) => r.n), [2, 3, 4]);
  assert.equal(b.size(), 3);
  assert.deepEqual(b.take(2).map((r) => r.n), [2, 3]);
  b.ack(2);
  assert.deepEqual(b.take(10).map((r) => r.n), [4]);
  assert.deepEqual(m.s.data.map((r) => r.n), [4]);
});
test('buffer: lädt Gespeichertes und übersteht Müll', () => {
  const b = createBuffer({ load: () => [{ n: 1, minute: 'm' }], save: () => {} });
  assert.equal(b.size(), 1);
  const c = createBuffer({ load: () => 'kaputt', save: () => {} });
  assert.equal(c.size(), 0);
  const d = createBuffer({ load: () => { throw new Error('x'); }, save: () => {} });
  assert.equal(d.size(), 0);
});
test('buffer: kaputte Elemente beim Laden und push(undefined) werden verworfen, max >= 1', () => {
  const m = mem([null, 1, 'x', {}, { minute: 5 }, { minute: 'a' }]);
  const b = createBuffer({ load: m.load, save: m.save, max: 0 });
  assert.equal(b.size(), 1);
  b.push(undefined);
  b.push([null, 3, { minute: 'b' }]);
  assert.deepEqual(b.take(10), [{ minute: 'b' }]);
});
test('buffer: ack über Größe hinaus und push einer Einzelzeile', () => {
  const m = mem([]);
  const b = createBuffer({ load: m.load, save: m.save });
  b.push({ n: 1, minute: 'm' });
  b.ack(5);
  assert.equal(b.size(), 0);
  assert.equal(m.s.saves, 2);
});
