const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveRelativeDate,
  detectDuplicate,
  archivePastEvents,
  buildContentHash,
} = require('../event-import.js');

test('resolveRelativeDate resolves German weekday phrases', () => {
  const now = new Date('2026-11-03T12:00:00+01:00');
  const nextFriday = resolveRelativeDate('nächsten Freitag', now);
  assert.ok(nextFriday);
  assert.equal(nextFriday.getFullYear(), 2026);
  assert.equal(nextFriday.getMonth() + 1, 11);
  assert.equal(nextFriday.getDate(), 6);
});

test('detectDuplicate matches same event across sources', () => {
  const existing = {
    title: 'Rave im Kulturhaus',
    location_name: 'Kulturhaus Erfurt',
    start_datetime: '2026-11-06T22:00:00+01:00'
  };

  const candidate = {
    title: 'Rave im Kulturhaus Erfurt',
    location_name: 'Kulturhaus',
    start_datetime: '2026-11-06T22:00:00+01:00'
  };

  assert.equal(detectDuplicate(existing, candidate), true);
});

test('archivePastEvents moves expired events into archive queue', () => {
  const now = new Date('2026-11-10T12:00:00+01:00');
  const result = archivePastEvents([
    { id: 'past', start_datetime: '2026-11-03T20:00:00+01:00' },
    { id: 'future', start_datetime: '2026-11-12T22:00:00+01:00' }
  ], now);

  assert.equal(result.archived.length, 1);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.archived[0].id, 'past');
});

test('buildContentHash is stable for equivalent inputs', () => {
  const a = buildContentHash({ title: 'Hausparty', start_datetime: '2026-11-10T20:00:00+01:00', venue: 'Bunker', price: '10 €' });
  const b = buildContentHash({ title: 'Hausparty', start_datetime: '2026-11-10T20:00:00+01:00', venue: 'Bunker', price: '10 €' });
  assert.equal(a, b);
});
