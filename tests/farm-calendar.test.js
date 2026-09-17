import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../knowledge/rules.json' with { type: 'json' };
import { getFarmCalendar, buildFarmCalendarICS } from '../src/farm-calendar.js';

const at = value => Date.parse(value);

test('calendar counts down to published milestones without claiming completed execution', () => {
  const mint = at(rules.schedule.mint_utc);
  const calendar = getFarmCalendar(mint - 1500);
  assert.equal(calendar.currentFirstSoil.phase, 'before_genesis');
  assert.equal(calendar.currentFirstSoil.multiplier, null);
  assert.equal(calendar.nextMilestone.id, 'mint-open');
  assert.equal(calendar.nextMilestone.countdown_ms, 1500);
  assert.equal(calendar.nextMilestone.countdown_seconds, 2);
  assert.deepEqual(calendar.milestones.map(x => x.status), ['next', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.match(calendar.note, /do not confirm mint, reveal or transaction completion/);
  assert.match(calendar.milestones[1].note, /date alone does not prove reveal/);
  const opening = getFarmCalendar(mint);
  assert.equal(opening.milestones[0].status, 'past');
  assert.equal(opening.nextMilestone.id, 'reveal-deadline');
});

test('First Soil uses exact UTC end-exclusive boundaries', () => {
  const [founding, soil] = rules.emissions.first_soil;
  const genesis = at(rules.schedule.genesis_utc);
  assert.equal(getFarmCalendar(genesis - 1).currentFirstSoil.multiplier, null);
  assert.equal(getFarmCalendar(genesis).currentFirstSoil.multiplier, 2);
  assert.equal(getFarmCalendar(at(founding.end_utc) - 1).currentFirstSoil.multiplier, 2);
  const transition = getFarmCalendar(at(founding.end_utc));
  assert.equal(transition.currentFirstSoil.multiplier, 1.5);
  assert.equal(transition.currentFirstSoil.phase, 'first_soil');
  assert.equal(transition.nextMilestone.id, 'first-soil-end');
  assert.equal(getFarmCalendar(at(soil.end_utc) - 1).currentFirstSoil.multiplier, 1.5);
  const end = getFarmCalendar(at(soil.end_utc));
  assert.equal(end.currentFirstSoil.multiplier, 1);
  assert.equal(end.currentFirstSoil.phase, 'standard');
  assert.equal(end.nextMilestone, null);
  assert.ok(end.milestones.every(x => x.status === 'past'));
});

test('calendar takes explicit instants and rejects invalid or ambiguous text dates', () => {
  const utc = getFarmCalendar('2026-09-21T00:00:00Z');
  assert.deepEqual(getFarmCalendar('2026-09-20T20:00:00-04:00'), utc);
  assert.deepEqual(getFarmCalendar(new Date('2026-09-21T00:00:00Z')), utc);
  for (const invalid of [NaN, Infinity, null, false, {}, '', '2026-09-21', '2026-09-21T00:00:00', 'not-a-date']) {
    assert.throws(() => getFarmCalendar(invalid), RangeError);
  }
  assert.ok(Number.isFinite(Date.parse(getFarmCalendar().evaluated_at_utc)));
});

test('calendar ICS preserves exact UTC times, stable IDs, escaping and UTF-8 line limits', () => {
  const now = '2026-09-12T12:34:56Z';
  const text = buildFarmCalendarICS(now);
  const unfolded = text.replace(/\r\n[ \t]/g, '');
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 5);
  assert.equal((unfolded.match(/STATUS:TENTATIVE/g) || []).length, 5);
  assert.ok(!text.replace(/\r\n/g, '').includes('\n'));
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  for (const expected of ['20260915T170000Z', '20260918T180000Z', '20260921T000000Z', '20260928T000000Z', '20261019T000000Z']) {
    assert.ok(unfolded.includes(`DTSTART:${expected}\r\n`));
  }
  assert.ok(unfolded.includes('DTSTAMP:20260912T123456Z'));
  assert.ok(unfolded.includes('At sellout\\, or by September 18'));
  assert.ok(unfolded.includes('1.5×'));
  assert.ok(unfolded.includes('\\nPublished schedule.'));
  const later = buildFarmCalendarICS('2026-12-01T00:00:00Z').replace(/\r\n[ \t]/g, '');
  assert.deepEqual(unfolded.match(/^UID:.*$/gm), later.match(/^UID:.*$/gm));
});
