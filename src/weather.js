// Almanac §06 controls planning. Reviewed WeatherOracle.multiplierAt confirms
// weekly × Flood × Moon with a 2× cap; multiplierNow remains the current-state read.
export const EVENT_SECONDS = { flood: 86400, moon: 172800 };
// Announced weeks have absolute epochs. Rebasing a plan must never move them.
export function validateWeatherWeeks(weeks = []) {
  if (!Array.isArray(weeks) || weeks.length > 209) throw new Error('Use at most 209 announced weather weeks.');
  const seen = new Set();
  for (const week of weeks) {
    if (!week || !Number.isInteger(week.epoch) || week.epoch < 0 || week.epoch > 208 || seen.has(week.epoch) ||
        ![5000, 8000, 10000, 12000, 15000].includes(week.multiplier_bps)) throw new Error('Announced weather needs distinct epochs and ordinary weekly multipliers.');
    seen.add(week.epoch);
  }
  return weeks;
}
export function eventWindows(events = []) {
  if (!Array.isArray(events) || events.length > 52) throw new Error('Use at most 52 weather events.');
  const windows = events.map(e => {
    if (!e || !Object.hasOwn(EVENT_SECONDS, e.type) || typeof e.start !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(e.start) || !Number.isFinite(Date.parse(e.start))) throw new Error('Each event needs flood or moon and a UTC start, e.g. 2026-09-21T12:00:00Z.');
    const start = Date.parse(e.start) / 1000;
    if (new Date(start * 1000).toISOString().replace('.000Z', 'Z') !== e.start) throw new Error('Use a real UTC calendar date for each event.');
    return { start, end: start + EVENT_SECONDS[e.type], type: e.type };
  }).sort((a, b) => a.start - b.start);
  for (const type of Object.keys(EVENT_SECONDS)) {
    const sameType = windows.filter(w => w.type === type);
    if (sameType.some((w, i) => i > 0 && w.start < sameType[i - 1].end)) throw new Error(`Overlapping ${type} events are duplicates or conflicting schedules; use one event of each type at a time.`);
  }
  return windows;
}
export function eventMultiplier(weeklyBps) { return Math.min(20000, weeklyBps * 2); }
export function weatherFlow(start, end, weeklyBps, windows, emissionBetween) {
  const relevant = windows.filter(w => w.start < end && w.end > start);
  const points = [...new Set([start, end, ...relevant.flatMap(w => [Math.max(start, w.start), Math.min(end, w.end)])])].sort((a, b) => a - b);
  let total = 0n;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const activeTypes = new Set(relevant.filter(w => w.start <= a && w.end > a).map(w => w.type));
    let multiplier = weeklyBps;
    for (let count = activeTypes.size; count > 0; count--) multiplier = eventMultiplier(multiplier);
    total += emissionBetween(a, b) * BigInt(multiplier) / 10000n;
  }
  return total;
}
