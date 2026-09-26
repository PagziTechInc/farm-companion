# Current contract review — September 11, 2026

**Current update: September 26.** [Planting V3, fixed first-use bags, sprouts, finalized reveal and Orchard](game-update-2026-09-26.md) supersede the older deployment, repricing and weather-owner descriptions below. Core CROP economics are unchanged.

The [Almanac](https://rh.farm/almanac/) remains published gameplay authority. This targeted source review explains economy v2 and records implementation conflicts. It supersedes the current-deployment conclusions in the [September 7 review](history/2026-09-07/contract-review.md), which remains historical evidence. No real transaction, signature or wallet approval was submitted. This is not a security audit or a locally reproduced compiler build.

## Evidence and deployment

All six current Sourcify v2 records report exact creation/runtime matches; independent public RPC `eth_getCode` bytes matched each source record's deployed runtime at chain 4663, block **60,592,342**, hash `0xa0c44f432d5cc2fa81dd8210b28c9fe5152b568e9de6655279f7e96c1b2df759`, **September 11, 21:58:34 UTC**. Complete sources, ABI, compiler metadata and runtimes are under [verified-contracts-2026-09-11](snapshots/verified-contracts-2026-09-11/review.json). The [compact manifest](reviewed-deployment.json) supports runtime checks before drafts. Node RPC calls were read-only; owner-restricted view methods were allowed to revert and errors are retained.

The Almanac directly links emissions, levels, NFT and weather. Current client configuration agrees. CROP and activation were independently resolved through the new emissions contract. Activation and levels link back to the new emissions, NFT and CROP. The NFT transfer hook points to the current activation. NFT, CROP, levels, emissions and activation have changed since September 7; **only weather stayed at the same address**.

| Contract | Current address | Runtime Keccak-256 |
| --- | --- | --- |
| emissions | `0x8ed784b4772ae3fdefafaa746fe405eb0410cdf3` | `0x010e25777f65ea0e83d2c39cee3b969951ffc86de0461ef23680ad01ddcea8b2` |
| levels | `0x4804043472416241d2334ecb3684fa179791bf8c` | `0x6b1005360575356eeaa099a08aeadbf9a0a525dcfc28e58d73e809920ad09eb4` |
| nft | `0x481ba120a6632714d8c872d1f4b6b57c8769dc21` | `0xa8bebed3f9ea474e01f95396bbb92b406005293d274b96ecd8ce646b4d17e493` |
| weather | `0xd45919b30bdac5f810a18434b3aac9c2d7093c67` | `0x715eeaafd15d174f204a6a71db458404e57b92b103c12f1af9a03538043118e1` |
| crop | `0x6cfaf2f60f47182f0c9f5d199db92ab261a9d487` | `0x1be44955cd2dae7359a6bd961da2ad9a8cb55041962d5b60fb2190488297e37d` |
| activation | `0xc7455c9dc27b3b5ceecbb3941e50185f17625431` | `0xbb1c60f4aa1cbf0814d8f0b3c5cab929e5d7d08fe57389f71eb9f75b54941a0a` |

At this block supply, total weight, emitted, paidOut and carryNow were zero. GranaryNow was **40M CROP**; the emissions contract held **800M CROP**. Activation bagOpen was true, bagPrice **0.001 ETH**, town balance **700M CROP**, and town allowance to activation **5M CROP**. Claims and upgrades were unpaused. These are historical observations, never assumed live balances.

## Revised reward accounting

[HarvestEmissions source](snapshots/verified-contracts-2026-09-11/source/emissions/src/HarvestEmissions.sol) constants set 2,000 CROP per weight unit per week, four 365-day years and budgets 380M/190M/95M/95M. First Soil factors are 20,000 BPS until Genesis+7 days, 15,000 until Genesis+28 days, then 10,000. The getter dates are September 28 and October 19 at 00:00 UTC.

`_accrueBetween` splits segments at year, weather/event and First Soil boundaries. For each interval:

1. Add `floor(yearBudget / YEAR) × seconds` to carry-in.
2. Compute nominal base `floor(2000e18 × totalWeightBps × seconds / (10000 × 604800))`.
3. Take the smaller of nominal base and available carry/schedule; retain unused funds as carry.
4. Multiply this base by weather times First Soil. The oracle caps weather/events at 2× before soil, so combined 4× is possible.
5. Fund above-base surplus from at most available Granary. Below-base shortfall replenishes Granary.
6. Add the farm payout to the 1e12 accumulator, distributed by recorded plot weight.

With no weight, `_update` adds schedule budget to **carry**, and Granary stays unchanged. The earlier zero-weight-to-Granary rule is obsolete for these contracts. Carry may support future capped earnings; it does not grant an immediate backlog claim to a new planter. After four years no new yield accrues; sweep settles rewards first and protects outstanding claim backing before sweeping unused carry/Granary.

`carryNow()` and `granaryNow()` calculate current virtual balances without a transaction. `farmRatePerSec()` projects the **next 24 hours at fixed current weight and scheduled weather**, then divides by 86,400. Multiplying an instantaneous share of the carry by many seconds would repeatedly spend the same stock; the current getter specifically avoids that error. Future projections must carry these finite balances forward exactly once and identify assumed or observed starting values.

The source uses integer divisions for schedule rates, segments and accumulator credits. Modelled daily decisions and continuous approximations cannot guarantee the same floors as future contract transaction timing. Deposits into Granary require actual transfers; do not insert the advertised 100M airdrop sweep before it occurs.

## Planting, upgrades and claims

[NativeActivation](snapshots/verified-contracts-2026-09-11/source/activation/src/activation/NativeActivation.sol) retains `plant(uint256)`: caller owns a dormant NFT, then 1,500 CROP burns and 1,000 CROP goes to treasury, using a total 2,500 allowance to activation. Activation records the timestamp and synchronizes emissions. There is no Genesis/reveal gate; the application's Genesis gate follows the published opening policy.

`plantWithBag(uint256)` is a separate payable entry point. It requires bagOpen, positive bagPrice and exactly that ETH amount, plus caller ownership and dormancy. It burns 1,500 CROP from treasury using treasury's allowance, forwards all ETH to treasury and synchronizes the plot. The contract holds no ETH after success. Treasury balance/allowance and forwarding must succeed, or the whole call reverts. `setBagPrice` permits an owner-set value up to 0.01 ETH, and sales can be closed. **Daily pool-price matching is not enforced by an oracle or schedule.** Always freshly read and simulate; standard CROP allowance never authorizes an ETH bag.

[FarmLevels](snapshots/verified-contracts-2026-09-11/source/levels/src/FarmLevels.sol) burns 5,000/10,000/20,000/50,000 CROP to reach levels 2/3/4/5. `costToReach` is incremental, not cumulative. `upgrade` remains one level per call, owner-only, pause-gated and capped at 5. Dormant upgrading is permitted but produces no earning weight until planting. Levels and activation wiring are one-shot after nonzero contract checks.

Claims retain `claim` and `claimMany`, ownership checks and pause gating. Each claim updates historical accrual and synchronizes the plot. Harvest has no separate game fee or CROP allowance, but ordinary gas still needs estimation. One invalid token in a batch reverts it. Pending CROP is a reward belonging to the NFT, not spendable wallet balance before claiming.

## Persistent discrepancies and controls

- [WeatherOracle](snapshots/verified-contracts-2026-09-11/source/weather/src/WeatherOracle.sol) is unchanged from September 7. `setNext` can overwrite future scheduled weather before the 24-hour cutoff and does not check `commitHash` or a preimage. The Almanac still promises sealed immutable outcomes. Historical replacement `eth_call` evidence remains valid for this identical runtime; no new mutation simulation was necessary.
- Floods and Moons double once each while active, then cap weather at 2×. Future weather getter fallbacks are not evidence of explicit scheduling. Claims settle history; claiming in good weather does not increase old harvest.
- [YieldFarmNFT](snapshots/verified-contracts-2026-09-11/source/nft/src/YieldFarmNFT.sol) still maps a hash residue 0 to offset 1. The zero offset is an unrevealed sentinel. A uniform-all-offsets model is hypothetical; uniform-hash weighting must remap residues and is not proof of randomness fairness.
- Owner-written rarity tiers remain mutable until finalized, and setters do not enforce the committed manifest or synchronize weight. New NFT manifestHash matches the exact previously cached manifest bytes. Positive reveal, finalized direct tiers and manifest/weight agreement remain necessary.
- The new NFT adds OpenSea Studio batch configuration and URI compatibility. Fixed supply and manifest setters accept the same value as a no-op, reject changing it. These changes do not eliminate mutable pre-finalized tiers or transfer-validator restrictions.
- Claims and upgrades can be paused independently. Activation can be replaced on emissions, requiring synchronization. The NFT's hook clears activation and attempts synchronization; caught failures can still leave recorded weights stale until a successful sync.

## Execution and remaining scope

The public application must require current chain/account, owned IDs, current reviewed runtime, linked targets, costs, balances, allowances and a successful fresh simulation before a short-lived draft. Every approval and every subsequent spend requires its own explicit button and wallet confirmation. Persist unresolved broadcasts across reload/imports; never unlock by an unrelated transaction hash. Importing a wallet or calculating a plan is not permission to transact. A new deployment must invalidate stale ownership identities and saved drafts.

Minting routes, swaps, store, drawings, vesting, pool behavior and treasury custody were not included in this six-core review. The public client publishes new ancillary addresses; they are labeled as supporting evidence only in integrations.json. No actual market quotes, paid fees or future liquidity guarantees are established by these sources.

## Separate airdrop dependency check

The new [MerkleAirdrop source](snapshots/airdrop-2026-09-11/MerkleAirdrop.sol) was separately matched to pinned RPC runtime; [its record](snapshots/airdrop-2026-09-11/review.json) carries its own block/time. It does not enter the six-contract execution allowlist. `deadline` is 1803859200, March 1, 2027, 00:00 UTC; `sweep()` is permissionless only when the block timestamp is strictly later. It sends the actual remaining CROP balance through `addToGranary` on the new emissions contract. Forecasts must not assume that future transfer has already occurred.

The immutable Merkle root is nonzero and the source permits any valid claim proof before the deadline. The Almanac's statement that nobody receives an allocation was not independently established by a proof of its leaf set. No user allocation or free planting CROP is inferred. A first historical RPC attempt returned a metadata-not-found error; the successful review used a fresh, separately pinned block and does not mix it with the six-core observation.


## September 15 runtime and rate recheck

All six reviewed runtime byte strings and linkage matched at chain 4663 block **63,958,680**, timestamp **September 15, 2026, 21:05:17 UTC**. The nominal rate remains 2,000 CROP/week per active weight unit, with the same annual base ceilings, carry, First Soil and finite Granary. This is a recheck of the existing source correspondence, not a new compiler reproduction or transaction review. The current Almanac also retains these limits.

At that block 2,290 plots were minted, startingIndex was zero, tiersFinalized false, total earning weight zero, carry zero and Granary 40M CROP. The published reveal deadline still matches the getter: September 18 at 18:00 UTC. `reveal()` needs a submitted transaction after its sellout/block or deadline condition; eligibility alone is not reveal. [Full evidence](snapshots/rate-review-2026-09-15/SUMMARY.md).
