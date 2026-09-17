// The Almanac specifies one shared cyclic offset, not independent tier draws.
// Probability results additionally assume each offset is equally likely.
export function cyclicAllocation(ids, tiers, sourceAware = false) {
  if (!Array.isArray(tiers) || !tiers.length || tiers.some(t => !Number.isInteger(t) || t < 0 || t > 3)) throw new Error('A valid committed tier table is required.');
  const n = tiers.length;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !Number.isInteger(id) || id < 1 || id > n)) throw new Error(`Use 1–100 distinct hypothetical token IDs from 1 to ${n}.`);
  const histogram = {}, totals = [0, 0, 0, 0], multipliers = [10000, 12500, 15000, 20000];
  let minWeight = Infinity, maxWeight = 0, goldenOffsets = 0;
  let goldenMass = 0n;
  const space = 1n << 256n, massBase = space / BigInt(n), massRemainder = space % BigInt(n);
  for (let offset = 0; offset < n; offset++) {
    const mapped = sourceAware && offset === 0 ? 1 : offset;
    const mass = massBase + (BigInt(offset) < massRemainder ? 1n : 0n);
    const counts = [0, 0, 0, 0]; let weight = 0;
    for (const id of ids) { const tier = tiers[(id - 1 + mapped) % n]; counts[tier]++; weight += multipliers[tier]; }
    counts.forEach((c, i) => { totals[i] += c; });
    histogram[counts[3]] = (histogram[counts[3]] ?? 0) + 1;
    if (counts[3]) { goldenOffsets++; goldenMass += mass; }
    minWeight = Math.min(minWeight, weight); maxWeight = Math.max(maxWeight, weight);
  }
  return { token_ids: ids, source_aware:sourceAware, reachable_offsets:sourceAware ? n-1 : n, offset_count: n, golden_offsets: goldenOffsets, probability_golden: sourceAware ? Number(goldenMass)/Number(space) : goldenOffsets / n,
    expected_counts: totals.map(v => v / n), min_weight_bps: minWeight, max_weight_bps: maxWeight,
    golden_count_offsets: histogram, assumption: sourceAware ? 'Uniform 256-bit hash assumption; deployed reveal remaps remainder 0 to offset 1. Counts enumerate hash residues; hypothetical IDs are not owned plots.' : 'Every cyclic starting offset is equally likely; hypothetical IDs are not owned plots.' };
}
