# Current rate, deployment, mint and reveal review — September 15, 2026

Read-only observation. The reviewed evidence is archived here after read-only collection. No execution, VPS or wallet state was changed by this review. Public HTTP responses and chain reads are separately timestamped. No signature or transaction was requested or sent.

## Result

The currently linked official economic deployment has **not changed from the reviewed September 11 deployment**: all six runtime byte strings and their Keccak-256 hashes exactly match both `knowledge/reviewed-deployment.json` and the archived exact-match Sourcify source records. Emissions wiring also remains the reviewed NFT, CROP, levels, weather and activation. The current [Almanac](https://rh.farm/almanac/) describes the same v2 rate formula already present in that deployed source. This observation cannot establish which older formula or UI presentation the user had in mind.

The current nominal weekly formula is `2000 × own weight × First Soil × weather`. Other farms do not dilute this nominal base while the schedule plus carry can pay it. The published annual ceiling and finite Granary are still material: the farm receives the smaller of total nominal base and available schedule/carry, then multiplies that funded base by weather and First Soil, with above-base surplus limited to available Granary. Above the ceiling the resulting farm amount is allocated by weight. Removing all valley-weight dependence from an exact long-horizon forecast would contradict both the current Almanac and unchanged source.

Year-one fresh budget supports approximately `380000000 / 365 × 7 / 2000 = 3643.835616` weight units absent carry. This threshold concerns base before multipliers. First Soil is 2× through September 28 00:00 UTC, 1.5× until October 19 00:00 UTC, then 1×. Weather/event cap is 2× before First Soil. There is no yield before Genesis, September 21 00:00 UTC.

## Pinned chain evidence

- Chain: 4663, public RPC `https://rpc.mainnet.chain.robinhood.com/rpc`.
- Block: **63,958,680** (`0x3cfee98`), hash `0x6439c71d2536acaeb3fb9ec8845c0e160154e98b8b593b2c56f8d84bbcda7415`.
- Block timestamp: **2026-09-15T21:05:17.000Z**. Observation began 21:05:17.127Z; initial reads completed 21:05:56.774Z. Throttled retries used the same block; all originally rate-limited reads succeeded and both attempts are retained in `chain-review.json`.
- The block hash was re-read and unchanged. Runtime bytes are archived individually as `*.runtime.hex`.
- NFT totalSupply **2290 / 3333**, sellOutBlock **0**, startingIndex **0**, tiersFinalized **false**.
- Manifest commitment unchanged: `0x80eba662f570dd94efbde3ed6351ada0313856bd9eccdd011b048be4ba709588`.
- revealDeadline **1789754400**, **September 18, 2026, 18:00 UTC / 2 PM ET**.
- Emissions totalWeight **0**, carryNow **0**, granaryNow **40,000,000 CROP**, farmRatePerSec **0**, emitted/paidOut **0**. Contract CROP balance **800,000,000 CROP**.
- RATE_PER_WEIGHT_PER_WEEK **2000 CROP**, YEAR **31536000 seconds**; budgets **380M / 190M / 95M / 95M** unchanged.
- Genesis/start **1789948800**, September 21 00:00 UTC. foundingWeekEnd **1790553600**, September 28 00:00 UTC. firstSoilEnd **1792368000**, October 19 00:00 UTC.
- Claims and upgrades unpaused. Seed bag open, exact current price **0.001 ETH**. These observations are not authorization or fresh transaction preparation.
- Weather epoch0, Sunny 12000 BPS, no Flood/Moon. Future `weatherOf` results may inherit and are not announced commitments.
- Sample NFTs 1 and 346 exist, level1, inactive, pending0, weight0. On-chain rarityTier0 is an unfinalized default and is **not** evidence of Common rarity.

Six addresses and hashes are preserved in `chain-review.json`; the official Almanac links emissions/levels/NFT/weather at the same addresses, and CROP/activation were confirmed by emissions getter linkage. HTTP link evidence is in `fetches.json` and `almanac.html`.

## Reveal conditions and published deadline

The Almanac promises reveal at sellout or by September 18, 2 PM ET, whichever is first. The unchanged NFT `reveal()` is permissionless but still requires someone to submit the transaction; an eligible date or sellout is not itself a positive revealed state. On the sellout path, execution must be later than `sellOutBlock + 1` and uses that following block's hash (or the previous block after the old hash expires). On the partial-mint deadline path, execution is allowed at or after revealDeadline. `mintSeaDrop` closes minting at the deadline or once a positive startingIndex exists. The source still remaps hash residue zero to offset one. The collector correctly waits for an actual positive offset and reviewed runtime/manifest, rather than requiring sellout or treating the deadline as completed reveal.

Source: [current NFT source record](https://sourcify.dev/server/v2/contract/4663/0x481ba120a6632714d8c872d1f4b6b57c8769dc21?fields=all), locally `knowledge/snapshots/verified-contracts-2026-09-11/source/nft/src/YieldFarmNFT.sol`, lines173–193 and416–440.

## Public API and hosted collector

HTTP observations at **21:04:36–37 UTC**, separately from the pinned block:

- [API stats](https://api.rh.farm/stats): supply2288, planted0, totalWeight0, no harvests, Granary40M. Supply rose to2290 at the later pinned block; these are not same-block measurements.
- [Plot1](https://api.rh.farm/plot/1) and [plot346](https://api.rh.farm/plot/346): `revealed:false`, `tiersFinalized:false`, `tier:null`, `weightBps:null`, level1, plantedfalse, pending0, `at:1789506276`.
- Both [metadata1](https://api.rh.farm/metadata/1) and [metadata346](https://api.rh.farm/metadata/346) retain Status:Unrevealed and shared `/image/unrevealed.png`. **They now include canonical animation_url despite remaining unrevealed**, unlike the September14 sample. An animation link is not evidence of revealed art or economic rarity.
- [Hosted collector status](https://farm.pagzi.tech/collection/status.json): HTTP200, phase `waiting_for_reveal`, collected0/3333. Last checked **21:04:22.213Z**, next scheduled **21:04:52.213Z**; chain observation **21:04:20.119Z**, block63958100, supply2288, startingIndex0, tiersFinalizedfalse, runtime_verifiedtrue, manifest_verifiedtrue. This confirms a fresh waiting collector at the observed time, not future uptime.
- `/security/` is now a moved-page link to [Provenance](https://rh.farm/provenance/). Provenance continues to link the reviewed NFT and weather addresses.

## Evidence files and source lines

- `fetches.json`: URLs, times, statuses, SHA-256, response headers and parsed JSON for bounded public fetches. `*.html`, `*.txt` and `api-*.json` retain actual bodies.
- `chain-review.json`: current addresses, runtime hashes, decoded reads, all RPC requests/responses, retry failures and successes.
- `source-files.json`: SHA-256 for relevant existing Solidity source files.
- Emissions source: `knowledge/snapshots/verified-contracts-2026-09-11/source/emissions/src/HarvestEmissions.sol`, constants lines24–38; yearly ceilings lines163–176; nominal rate and combined multiplier lines230–247; finite Granary lines256–272; schedule/carry cap lines280–313; allocation lines331–334. [Sourcify source record](https://sourcify.dev/server/v2/contract/4663/0x8ed784b4772ae3fdefafaa746fe405eb0410cdf3?fields=all).
- Local live Almanac text lines41–43,65–66,81,114–119 and144–146 cover the formula, limits and deadlines.

No source re-download was needed: the archived exact-match source runtime equals the fresh independently read runtime byte-for-byte. This is source correspondence, not a new compiler reproduction or complete security audit.
