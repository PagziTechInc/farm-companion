# Launch weather evidence

Pinned chain 4663 block 62434395 (2026-09-14T01:56:32.000Z); retrieved through 2026-09-14T01:58:31.039Z.

Official pages fetched fresh: https://rh.farm/, https://rh.farm/almanac/, https://rh.farm/townhall/. Full retrieval times, script URLs and SHA256 values: fetches.json. Relevant display-source snippets: relevant-snippets.json.

WeatherOracle runtime equals the reviewed exact-match runtime. One immutable commitHash identifies the launch 12-week list; the contract has no per-week commitment getters or commit preimage/reveal verification. The same hash is not 12 known outcomes.
Commit hash: `0x46f41dbcb8d9c74f8dd4c20bedb8f0b9e3ac4de373f2a3244b311e3f1ea0fe95`.
Deployment: block 52799568 at 2026-09-02T18:51:08.000Z; before the published September 15 mint.

The only WeatherScheduled event from deployment through the pinned block is epoch 0 / Sunny (enum 1), emitted at block 52808670, 2026-09-02T19:06:55Z. Pinned _scheduled mapping reads independently confirm epoch 0 raw 2 and all other launch epochs raw 0 (unset). weatherOf returns Sunny for all twelve because unset epochs inherit earlier weather, which is not an explicit future announcement.

| Week | UTC start | UTC end | Explicit schedule |
| --- | --- | --- | --- |
| 1 | 2026-09-21 | 2026-09-28 | Sunny |
| 2 | 2026-09-28 | 2026-10-05 | Unknown / unset |
| 3 | 2026-10-05 | 2026-10-12 | Unknown / unset |
| 4 | 2026-10-12 | 2026-10-19 | Unknown / unset |
| 5 | 2026-10-19 | 2026-10-26 | Unknown / unset |
| 6 | 2026-10-26 | 2026-11-02 | Unknown / unset |
| 7 | 2026-11-02 | 2026-11-09 | Unknown / unset |
| 8 | 2026-11-09 | 2026-11-16 | Unknown / unset |
| 9 | 2026-11-16 | 2026-11-23 | Unknown / unset |
| 10 | 2026-11-23 | 2026-11-30 | Unknown / unset |
| 11 | 2026-11-30 | 2026-12-07 | Unknown / unset |
| 12 | 2026-12-07 | 2026-12-14 | Unknown / unset |

Every date is at 00:00 UTC. Use half-open [start, end) intervals. Epoch = floor((timestamp - Genesis) / 604800) on/after Genesis; no farming earnings before Genesis.

Safe forecast inputs: apply observed Sunny=12000 BPS only within epoch 0 (Sep 21–28). Future unannounced weeks use an explicit user assumption, such as Fair=10000 BPS, not the getter’s current inherited Sunny. Absolute epoch keys must survive moving a forecast start. Observed schedules can be changed before their cutoff, so cache date/block provenance and refresh. After a historical/current epoch cutoff has passed, actual weatherOf inheritance is executable chain behavior even when no explicit write exists; do not mislabel a retrospective fallback as a new forecast announcement.

First Soil doubles the founding week, so 2.0 × Sunny 1.2 = 2.40 combined before finite Granary limits; weather must not be multiplied by 2.40 and then by soil again. First Soil is 1.5 for Sep 28–Oct 19 and 1 afterward. No flood or moon is scheduled at this block.

Deadline: setNext accepts iff block.timestamp + TIMELOCK <= epochStart(epoch), with TIMELOCK=86400; epoch 0 can still be changed through Sep 20 00:00:00 UTC, inclusive. There is no obligation to submit or reveal every week, and no commitment verification. The source enforces lead time for writes and immutable history after cutoff, not the Almanac promise that a committed week cannot be changed. Town Hall promises at least 24h advance publication; the Almanac weather text still describes revelation at the boundary. Preserve that published discrepancy instead of silently choosing the supporting page over the Almanac.

Practical integration: public RPC eth_getLogs over deployment block 52799568 through a pinned block succeeded in <1 second. Topic0 = 0x45a477802ad48453b07d7be5e15e0166f708d2bc844465fda64c2f3a6085b76c (WeatherScheduled(uint256,uint8)). Validate exact contract address/topic, canonical log bounds and enum, reject removed logs, select latest per epoch by block/transaction/log index; check selected value against same-block weatherOf. On RPC failure, mark unavailable rather than treat missing logs as no schedule. Runtime-gated storage slot 2 is independently proven but less ABI-stable; log reads are preferred for the app.

This evidence was collected read-only and subsequently archived with the implementation. No wallet access, signing or transaction submission.

The implemented public season adapter was also exercised live at block 62445808 (2026-09-14T02:15:50Z), chain 4663. `adapter-smoke.json` records no read errors and exactly the same single explicit epoch-0 Sunny schedule, with reviewed runtime and pinned event/getter checks. This is a separate later observation, not part of block 62434395.
