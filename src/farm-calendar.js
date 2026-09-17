import rules from '../knowledge/rules.json' with { type: 'json' };

const SOURCE = 'https://rh.farm/almanac/';
const SCHEDULE_NOTE = 'Published schedule. Dates do not confirm mint, reveal or transaction completion.';

function calendarTime(now) {
  if (!(now instanceof Date) && typeof now !== 'number' && typeof now !== 'string') throw new RangeError('Enter a valid calendar time.');
  if (typeof now === 'string' && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(now)) throw new RangeError('Calendar text dates need an explicit time zone.');
  const value = new Date(now).getTime();
  if (!Number.isFinite(value)) throw new RangeError('Enter a valid calendar time.');
  return value;
}

function publishedMilestones() {
  const [founding, firstSoil] = rules.emissions.first_soil;
  return [
    { id: 'mint-open', label: 'Mint opens', at_utc: rules.schedule.mint_utc, note: 'Published mint opening. Check the official drop for availability.' },
    { id: 'reveal-deadline', label: 'Reveal deadline', at_utc: rules.schedule.client_reveal_deadline_utc, note: `${rules.schedule.reveal} A date alone does not prove reveal or finalized rarity.` },
    { id: 'genesis', label: 'Genesis · Founding Week', at_utc: rules.schedule.genesis_utc, note: `Plant season begins. First Soil ${founding.multiplier_bps / 10000}× for planted plots; bonus rewards depend on the Granary.` },
    { id: 'founding-week-end', label: `First Soil shifts to ${firstSoil.multiplier_bps / 10000}×`, at_utc: founding.end_utc, note: `Founding Week ends. First Soil becomes ${firstSoil.multiplier_bps / 10000}× until ${firstSoil.end_utc}; bonus rewards depend on the Granary.` },
    { id: 'first-soil-end', label: 'First Soil ends', at_utc: firstSoil.end_utc, note: 'The First Soil multiplier returns to 1×. Weekly weather continues separately.' },
  ].sort((a, b) => Date.parse(a.at_utc) - Date.parse(b.at_utc));
}

/** Published milestones at a UTC instant; never an observation of chain state. */
export function getFarmCalendar(now = Date.now()) {
  const time = calendarTime(now);
  const genesis = Date.parse(rules.schedule.genesis_utc);
  const phases = rules.emissions.first_soil;
  const phaseIndex = phases.findIndex(phase => time >= Date.parse(phase.start_utc) && time < Date.parse(phase.end_utc));
  const phase = phases[phaseIndex];
  const currentFirstSoil = time < genesis ? {
    phase: 'before_genesis', label: 'First Soil starts at Genesis', multiplier: null, multiplier_bps: null,
    start_utc: rules.schedule.genesis_utc, end_utc: phases[0].end_utc, note: 'No harvest before Genesis.',
  } : phase ? {
    phase: phaseIndex === 0 ? 'founding_week' : 'first_soil', label: phaseIndex === 0 ? 'Founding Week' : 'First Soil',
    multiplier: phase.multiplier_bps / 10000, multiplier_bps: phase.multiplier_bps,
    start_utc: phase.start_utc, end_utc: phase.end_utc, note: 'Applied after weather; bonus rewards depend on available Granary.',
  } : {
    phase: 'standard', label: 'Standard soil', multiplier: 1, multiplier_bps: 10000,
    start_utc: phases.at(-1).end_utc, end_utc: null, note: 'First Soil has ended. Weekly weather is separate.',
  };
  let foundNext = false;
  const milestones = publishedMilestones().map(milestone => {
    const past = Date.parse(milestone.at_utc) <= time;
    const status = past ? 'past' : foundNext ? 'upcoming' : 'next';
    if (!past) foundNext = true;
    return { ...milestone, status };
  });
  const upcoming = milestones.find(milestone => milestone.status === 'next');
  const countdown = upcoming ? Date.parse(upcoming.at_utc) - time : null;
  return {
    evaluated_at_utc: new Date(time).toISOString(), source_url: SOURCE, reviewed_on_utc: rules.reviewed_on_utc,
    note: SCHEDULE_NOTE, currentFirstSoil, milestones,
    nextMilestone: upcoming ? { ...upcoming, countdown_ms: countdown, countdown_seconds: Math.ceil(countdown / 1000) } : null,
  };
}

const icsDate = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

// RFC 5545 folds at 75 UTF-8 octets without splitting a code point.
function foldCalendarLine(line) {
  const lines = [];
  let current = '', octets = 0;
  for (const character of line) {
    const width = new TextEncoder().encode(character).length;
    if (octets + width > 75) { lines.push(current); current = ' '; octets = 1; }
    current += character; octets += width;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** A local calendar download with UTC times and no assumed execution status. */
export function buildFarmCalendarICS(now = Date.now()) {
  const calendar = getFarmCalendar(now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Farm Companion//Yield Farm milestones//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Yield Farm milestones'];
  for (const milestone of calendar.milestones) {
    lines.push('BEGIN:VEVENT', `UID:${milestone.id}-${icsDate(milestone.at_utc)}@farm-companion`,
      `DTSTAMP:${icsDate(calendar.evaluated_at_utc)}`, `DTSTART:${icsDate(milestone.at_utc)}`,
      `SUMMARY:${icsText(`Yield Farm: ${milestone.label}`)}`, `DESCRIPTION:${icsText(`${milestone.note}\n${SCHEDULE_NOTE}`)}`,
      `URL:${SOURCE}`, 'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}
