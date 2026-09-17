# Yield Farm: local rulebook

Read this and [decisions.json](decisions.json) first. Constants live in [rules.json](rules.json); source IDs resolve in [sources.json](sources.json). This is a factual digest, not a copy of the Almanac. Research date: September 6 Toronto / September 7, 2026 UTC.

## Quick decisions

- We expect **22 plots, 11 in each wallet**. Both public addresses are configured; the latest saved reads show no minted holdings. Refresh balances and ownership for current decisions; future rarity remains unknown.
- Initial planting requires **55,000 CROP total**. This does not include acquisition, swap or wallet-paid network costs.
- Weight, not the number of harvest clicks, determines ordinary emissions. Claimed rewards can fund upgrades; unclaimed rewards cannot be spent directly as a wallet balance.
- Compare upgrades by their **extra portfolio earnings minus cost**. Bigger gross yield does not establish better profit. At the same upgrade step, greater rarity adds more weight for the same price; across different steps, rarity alone is not enough to rank actions.
- Account for the other 21 plots losing a small part of their share when one is upgraded. Everyone else's planting/upgrading also changes our returns.
- Keep the two-wallet split as the baseline. Moving CROP is permitted in proposed strategies. Moving an active NFT clears planting under the published rule, even though level, rarity and pending CROP travel with it.
- Claims settle historical accrual at its applicable year/weather boundaries, as confirmed by source. Waiting for good weather to claim does not reprice earlier rewards. Claim when liquidity for a worthwhile action or the net value of collection justifies its cost.
- Store prices, sealed future weather, market prices, gas sponsorship and NFT resale premiums are not known constants.

## Evidence and dates

The user confirmed on September 7 that none of our planned plots has been minted. Keep the real portfolio empty. The wallet-free [season snapshot](snapshots/season-2026-09-07.json), block **56,632,260** at **2026-09-07 06:49:00 UTC**, reads epoch **0**, **Sunny**, effective **1.2×**, no active Flood or Moon, no registered Moon entries, **0** minted NFTs and **0** planted farm weight. Both epoch 0 start and next boundary read September 21 at 00:00 UTC. This is a pre-Genesis observation, not proof of the eventual launch-week outcome or future weather. A zero Moon count means none registered at that block, not that future Moons cannot be added. The commitment is stored with the observation; it does not disclose future weeks.

The homepage currently publishes **0.002 ETH** per mint, or **0.044 ETH** for 22 before fees. Legacy NFT `PRICE()` and `saleState()` calls reverted during this follow-up, so price and sale availability must not be represented as verified getters. Under a uniform draw without replacement from all 3,333 entries, 22 draws have a derived **19.7163%** probability of at least one Golden Acre. This is an explicit allocation model, not proof of uniform randomness for particular mint positions or known user traits.

The historical [RPC snapshot](snapshots/chain-2026-09-07.json), at block **56,499,166**, confirms the planting fee, each next-level fee, activation address and Genesis timestamp. Oracle epoch 0 returned enum 1 and effective multiplier 12,000 BPS; the inspected client labels enum 1 **Sunny**. This is evidence for that observation, not a perpetual forecast.

Genesis: **September 21, 2026, 00:00 UTC**, or **September 20 at 8 p.m. Toronto time**. Published mint time: September 15 at 17:00 UTC; pool opening is planned for September 18. The client/metadata gives a September 18, 18:00 UTC reveal deadline. See U04 for differences in reveal wording.

`published_rule` means the official site states it; `verified_read` means a particular public response was observed; `derived` means calculated from identified inputs. A successful getter read does not prove every aspect of the contract is immutable. Six sources were later obtained through Sourcify v2 and independently matched by runtime hash at block 57,200,789. `verified_source` refers to that targeted source review; compilation and published audits were not reproduced. See [contract review](contract-review.md).

Sources: [Almanac](https://rh.farm/almanac/), [Town Hall](https://rh.farm/townhall/), [contract directory](https://rh.farm/security/), and local RPC evidence.

## Plot allocation, planting and upgrades

There are 3,333 farm NFTs. A committed manifest supplies the traits and tier; token `i` maps to row `(i - 1 + startingIndex) % 3333` after reveal. Do not map token 1 to row 0 before the starting index is known. `source_row` is not the manifest array index. The local API copy has the announced tier counts, and its exact raw bytes' Keccak-256 matches `manifestHash()` at block **56,530,213**. See the [comparison evidence](snapshots/manifest-comparison-2026-09-07.json). SHA-256 is a separate local integrity checksum; it is not the contract's commitment algorithm.

| Rarity | Count | Weight multiplier |
| --- | ---: | ---: |
| Common | 2,475 | 1× |
| Fertile | 660 | 1.25× |
| Prize Plot | 165 | 1.5× |
| Golden Acre | 33 | 2× |

Crop, soil and the other art traits inform rarity; no extra agronomy effects are established. There is no documented crop rotation, watering or repeated planting cycle during continuous ownership.

Planting pays 2,500 CROP: 1,500 burned and 1,000 to treasury. A dormant plot has no earning weight. Verified activation requires a CROP allowance to NativeActivation; upgrading requires an allowance to FarmLevels; harvesting requires neither. The NFT remains in the wallet. Exact allowance approval alone does not execute the game action.

| Level | Name | Level multiplier | Cost of this step, CROP | Cumulative upgrades, CROP |
| --- | --- | ---: | ---: | ---: |
| 1 | Seedlings | 1× | 0 | 0 |
| 2 | Barn | 1.25× | 10,000 | 10,000 |
| 3 | Tractor | 1.5× | 25,000 | 35,000 |
| 4 | Silo | 2× | 60,000 | 95,000 |
| 5 | Windmill | 3× | 150,000 | 245,000 |

Upgrades are permanent and published as fully burned. Fees are incremental, not cumulative quotes. All 22 maxed from level 1 would consume 5,390,000 CROP in upgrades, plus 55,000 for planting. These are cost identities, not recommendations.

Sources: [home](https://rh.farm/), [Almanac](https://rh.farm/almanac/), [Provenance](https://rh.farm/provenance/), block-pinned fee reads.

## Yield and investment arithmetic

Ordinary plot weight is level multiplier times rarity multiplier. Use exact BPS and token base units internally. Read actual `weightOf` when deciding: activation, synchronization and future modifiers can make nominal weight insufficient.

With common weather across plots:

```text
portfolio rate = F × m × P / T
upgrade increment = F × m × [(P + delta) / (T + delta) − P / T]
simple payback = incremental CROP cost / positive incremental CROP rate
```

`F` is base emission per second, `m` the effective weather multiplier, `P` our combined planted weight, and `T` total planted weight INCLUDING ours. `delta` is the added weight. A planting action on a dormant plot adds its full active weight. If `T` is zero the old rate is zero; calculate the new state directly instead of dividing by zero.

Simple payback freezes conditions and ignores reinvestment timing, price changes and fees. It is a diagnostic, not the optimization objective. For each horizon, compare complete, affordable upgrade sequences to the no-upgrade baseline. Simulate accrual between changes in weights, weather and emission years; claim only makes pending tokens liquid. Respect each wallet's cash and transaction timing. Do not spend pending rewards twice, pool two wallet balances silently, or treat an incoming CROP transfer as profit.

Year budgets are **380M, 190M, 95M, 95M CROP**: 760M base emissions. Year four is not another halving. The advertised 800M includes the initial 40M weather buffer. No base-emission budget after year four is specified; do not interpret promotional references to earning forever as a perpetual rate. Source confirms four 365-day years. Each annual budget is integer-divided into a per-second wei rate and settled through a 1e12-precision accumulator. The scenario engine retains daily rounding and does not reproduce all accumulator floors or Granary depletion; its results remain projections.

See [worked examples](worked-examples.md) and [scenario contracts](../portfolio/README.md) for net-return definitions. The baseline fully planted level-1 farm has exact total weight **3,613.5**, not 3,333; the page's illustrative calculator uses an average for other plots and is not live state.

Sources: [Almanac](https://rh.farm/almanac/); formulas and exact weight total are derived here.

## Weather and temporary effects

Weekly rollover is Monday 00:00 UTC. Multipliers: Locusts 0.5×, Drought 0.8×, Fair 1×, Sunny 1.2×, Rain 1.5×. Higher weather uses the Granary; lower weather replenishes it. Weeks are described as committed at least 24 hours ahead, with 12 launch commitments. A hash does not disclose the outcome.

Almanac section 06 is authoritative for planning: Flash Floods last 24 hours and Harvest Moons 48 hours; events stack on weekly weather with a 2× total cap. We interpret a single 2× event multiplicatively, so Locusts becomes 1×, Drought 1.6×, and Fair/Sunny/Rain 2×. Town Hall's override wording does not control the model. Verified `multiplierAt` confirms doubling once for a covering Flood and once for a covering Moon, with the cap after both. A Flood and Moon may overlap; under Locusts both together give a nominal 2× multiplier. The engine accepts different-kind overlap, rejects same-kind duplicate overlap, integrates event boundaries, and never infers future events from a hash. Actual above-base rewards draw at most the available Granary; an empty Granary limits them to base. This exhaustion is not modeled by the strategy engine. Current state still uses `multiplierNow()`. Town Hall currently says Moons are posted at least 30 days ahead; our older one-year-ahead note is superseded.

November supplies are provisional: fertilizer advertises +25% plot weight for a week; a tarp advertises a weather floor of 1× for the plot. Prices and detailed behavior are unknown. A per-plot tarp cannot simply be inserted into the common-weather portfolio formula. Cosmetics have no documented yield benefit.

Sources: [Town Hall](https://rh.farm/townhall/), [Store](https://rh.farm/store/), [Almanac](https://rh.farm/almanac/).

## Harvests, fees and wallet transfers

The published harvest game fee is zero and claims do not need token approval. The current client uses `claim` and `claimMany` on-chain writes, not an observed gasless-message relay. Chain gas price was nonzero during research. Neither a gas price nor a client gas limit establishes the user's final cost: sponsorship and actual gas use remain unknown. Model measured/estimated fees and a clearly labeled zero-wallet-paid-gas case.

Harvest batches operate under one caller wallet. Two wallets require separate caller actions; there is no documented cross-wallet batch. Moving all assets to one wallet is not inherently profitable. Moving the other wallet's 11 active plots costs 27,500 CROP to reactivate, plus transfer costs and any downtime. Before first planting, consolidation has no lost activation payment, but the usual initial planting and transfer costs still apply. Pending CROP moves with the NFT; it is not duplicated or lost by assumption.

Other published charges: names cost 100 CROP burned; secondary royalty is currently 5%, with a 10% cap; site swap fee is 0.5% from pool launch. These do not establish the whole cost of an executable trade: account for quoted liquidity, pool/marketplace fees, price impact and wallet-paid network costs without double-counting included fees.

Sources: [Almanac](https://rh.farm/almanac/), [current farm client](https://rh.farm/_next/static/chunks/0zd5y-h191ny8.js), [Security](https://rh.farm/security/).

## Store, drawings, supply and controls

Season skins are published as removable for free and resellable; equipped skins travel with a sold plot. Planned prices and supply caps are in `rules.json`. Final store listings must be read at opening. Do not assume an upgrade or cosmetic resale premium equals its burned cost.

From October, every planted plot is promised one automatic weekly drawing entry. That would mean 22 entries if all ours are planted, not 22 per wallet. Paid tickets burn CROP. Prizes and spend limits are tied to ticket funding, with thin weeks potentially rolling forward. No paid-ticket expected-value advice until final rules and odds are known.

The fixed 2B CROP allocation is 760M emissions, 40M initial Granary, 100M airdrop-designated pool, 200M treasury vest, 200M team vest and 700M liquid treasury. The airdrop is described as unclaimable and directed to the Granary after March 1, 2027; do not count free airdropped planting funds. Treasury no-selling in year one is a published policy. A six-month team cliff does not establish that selling is impossible throughout the first year.

The owner can pause claims and, independently, upgrades, change activation under guards, manage store listings, spend treasury and adjust royalty within its cap. Source confirms pending views and accrual continue while claims are paused. The weather scheduler can replace a scheduled epoch before its cutoff without enforcing the published commitment promise; this discrepancy is material to forecasts. The site's audit/test and immutability claims were not independently reproduced. The separate Founding Charter is not a farm plot or an established yield multiplier.

Getting started requires an EVM wallet, Robinhood Chain and ETH. The site advertises OpenSea swaps or a canonical bridge; its seven-day canonical exit estimate and other routing claims are time-sensitive. Recheck an actual route if needed. Neither credentials nor a wallet connection are needed to read public addresses.

Sources: [Store](https://rh.farm/store/), [Town Hall](https://rh.farm/townhall/), [Security](https://rh.farm/security/), [Almanac](https://rh.farm/almanac/).

## Refresh only what changed

Use cached rules first. Refresh ownership, activation, levels/effective weights, pending rewards, balances, total farm weight, effective weather, emission state and price/fee quotes for a current decision. Record block and time. Never interpret an HTTP/RPC error or a missing field as a zero balance or default Common tier.

Review only the relevant source when a contract address changes, a rule announcement arrives, an unresolved mechanic becomes necessary, or the chain conflicts with this reference. Keep old snapshots as evidence. Browser and CLI monitoring are available only when explicitly enabled; no scheduled service is installed.

## Source priority and pre-mint allocation

User instruction: the Almanac controls gameplay planning. Source access failures do not make supplementary text authoritative. See [research answers](unresolved.md) for all ten original questions, what is settled, and what remains unavailable.

Token allocation uses a shared cyclic offset, not independent rarity draws. Enumerate all 3,333 offsets for hypothetical IDs under an explicit uniform-offset assumption. For contiguous IDs 1–22, 626 offsets include a Golden Acre: **18.7819%**, versus 19.7163% under the different uniform-subset model. Two separated batches may differ. Neither probability assigns traits or ownership. The cyclic model is implemented in `src/allocation.js`. Verified reveal code remaps modulo residue zero onto offset one, so uniformly weighting all 3,333 offsets is hypothetical rather than the deployed distribution. A source-weighted model can condition on a uniform 256-bit hash, but hash uniformity or lack of influence is not established. The source also treats `startingIndex == 0` as unrevealed; positive index, finalized on-chain tiers, manifest agreement and weight synchronization are required before rarity is used in live planning.

## Verified source changes and active execution

The [September 7 contract review](contract-review.md) and [pinned evidence](snapshots/execution-research-2026-09-07.json) supersede earlier source-access failures. Six contract responses report exact creation/runtime matches; their runtime hashes matched independent public RPC at block **57,200,789**, **22:45:01 UTC**. No real transaction or signature was submitted during this research. This is a targeted implementation review, not a security audit.

Keep these implementation facts separate from the Almanac's gameplay authority:

- `setNext` allows an owner/keeper to replace future scheduled weather before its 24-hour cutoff without checking a commitment preimage. A commitment is not proof of immutable upcoming weather.
- Source planting and upgrade functions have no Genesis/reveal gate; dormant upgrades are allowed. The companion still waits for the Almanac Genesis opening and prioritizes planting before yield upgrades as application policy.
- Before reveal or tier finalization, a default zero direct tier does not establish Common. An owner-written tier can change until finalized; verify its match to the manifest and `desiredWeight` versus `weightOf`.
- With no planted weight, base emissions enter the Granary. The first planter has no entitlement to the earlier unallocated backlog. Above-base weather cannot draw more than the Granary contains.
- Transfer hooks clear planting and attempt synchronization, but caught hook failures can leave stale recorded weight. A mismatch needs current synchronization evidence, not a silent nominal substitution.

The user now requests an active guided plan with human-approved actions, superseding the earlier read-only scope. Public refreshes and plan calculations may run when enabled. The executor supports one plant, one-level upgrade, or a same-wallet claim batch, with exact CROP allowances as separate transactions. Every submit requires explicit review and MetaMask confirmation; no autonomous signing, swaps, minting or transfers are enabled. A pending or uncertain broadcast blocks further actions until reconciled.

Use the current-time guided plan for decisions, not historical scenario dates. Compare rare next-step returns with all other eligible paths and preserve the no-upgrade baseline. The timing diagnostic estimates the cost of delaying dormant planting while holding other actions fixed. Stress cases rerun the selected strategy policy under changed competition/weather/prices and do not establish guaranteed profit. An explicit extra-investment cap and executable CROP quotes remain needed; a USD 100 funding target is not that cap.
