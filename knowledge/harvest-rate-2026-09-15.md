# Your harvest rate — September 15, 2026

The current [Almanac, Weight](https://rh.farm/almanac/#weight) starts with the rate of an individual planted plot:

`weekly nominal CROP = 2,000 × your active weight × First Soil × weather`

No share-of-valley denominator belongs in that nominal formula. Another farmer planting does not lower it while the funding limits can cover the rate. Dormant plots earn zero. A Common level-1 plot in the Sunny Founding Week has a nominal weekly rate of 4,800 CROP; a Golden level-1 plot has 9,600. These are rates at that time, not guaranteed earnings for an arbitrary later week.

The same Almanac retains the annual base ceiling and finite Granary. The base is limited by released schedule plus carry, before weather and First Soil; the Granary pays bonuses while available. Above the base ceiling, funded base is shared by weight. Total valley weight can therefore affect a constrained payout, although it does not define the nominal rate. Removing all funding limits would contradict both the published rules and verified source.

Independent reads at chain 4663 block 63,958,680, September 15 at 21:05:17 UTC, matched all six September 11 runtimes byte for byte. No changed economic deployment was observed. The existing settlement kernel already implements this nominal-rate model; the misleading mandatory competition input and automatic full-collection planting scenario needed revision.

Version 2.9 leads with the nominal rate and keeps projected term earnings separately constrained by finite funding. Outside weight is optional and defaults to zero when unspecified, rather than assuming every plot is planted. This is an explicit rate scenario, not evidence that no other farm exists. Advanced harvest-limit scenarios and valid observed post-Genesis inputs remain available, and saved explicit assumptions are preserved. Upgrade timers, per-wallet goals, route comparisons, active plans and CLI policies continue using the shared finite settlement engine. The guided plan tests an empty Granary, harsh weather and a lower exit price.

Saved workspaces migrate the old full-collection default only when explicit automatic-field markers, a matching value and pre-Genesis evidence identify it. Manual choices, custom paths, reserve timing overrides, post-Genesis observations and ambiguous older saves stay intact. A version marker makes this migration run once; **Use chain defaults** remains the explicit way to replace a custom scenario.

Minting is separate from reveal. The pinned observation found 2,290 minted plots, zero reveal offset, unfinalized tiers and zero earning weight. API samples 1 and 346 still said unrevealed and used placeholder art, although their metadata now included animation links. Reveal can follow sellout or the September 18, 18:00 UTC deadline, and still requires a transaction. Mint counts, dates and animation links never establish actual traits.

Evidence: [live Almanac bytes](snapshots/almanac-2026-09-15/almanac.html), [retrieval record](snapshots/almanac-2026-09-15/retrieval.json), [source and live-state review](snapshots/rate-review-2026-09-15/SUMMARY.md), [pinned calls](snapshots/rate-review-2026-09-15/chain-review.json). Historical observations are not current holdings, prices or reveal status.
