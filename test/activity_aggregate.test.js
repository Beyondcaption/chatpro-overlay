const { test } = require('node:test');
const assert = require('node:assert');
const { createAggregator } = require('../src/activity/aggregate');

test('aggregator: zählt und setzt nach flush zurück', () => {
  const a = createAggregator();
  a.key(); a.key(); a.key(); a.mouse();
  a.sample('X'); a.sample('Discord'); a.sample('Discord');
  assert.deepEqual(a.flush('2026-11-09T10:00:00.000Z'), { minute: '2026-11-09T10:00:00.000Z', keys: 3, mouse: 1, site: 'Discord' });
  assert.deepEqual(a.flush('2026-11-09T10:01:00.000Z'), { minute: '2026-11-09T10:01:00.000Z', keys: 0, mouse: 0, site: null });
});
test('aggregator: Gleichstand -> jüngster Sample', () => {
  const a = createAggregator();
  a.sample('X'); a.sample('Discord'); a.sample('X'); a.sample('Discord');
  assert.equal(a.flush('m').site, 'Discord');
  a.sample('Discord'); a.sample('X');
  assert.equal(a.flush('m').site, 'X');
});
test('aggregator: null-Samples werden ignoriert', () => {
  const a = createAggregator();
  a.sample(null); a.sample(undefined); a.sample('X');
  assert.equal(a.flush('m').site, 'X');
});
