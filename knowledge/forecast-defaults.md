# Forecast defaults — September 13, revised September 16, 2026

## Automatic companion (v2.10)

`automaticForecast` wraps the existing defaults for the simplified public flow. Adding or connecting a wallet produces forecasts and upgrade comparisons without submitting a settings form. Fresh portfolio snapshots can supply the pinned reserve pair directly; same-block optional pool reads improve prices without delaying import. Dormant plots are planted only in a separate forecast copy, with their planting capital displayed separately.

Before Genesis or without fresh planted-weight evidence, shared-limit estimates use 30% of remaining published level-1 collection weight. This is the user's participation scenario, not an observed fact, and never dilutes nominal own yield. Fresh post-Genesis outside weight replaces it; model plots do not subtract from observed network weight. Unknown weather stays Fair, known dated announcements and First Soil apply automatically.

Active-plan defaults use assumed gas budgets of 200k claim, 250k upgrade, 350k plant, 65k transfer, 400k buy and 200k NFT transfer, at 0.1 gwei with a 2x allowance and minimum 0.000001 ETH per operation. These are planning estimates, not observed gas usage or executable quotes. Pool/bag price references are inherited from the normal defaults. No spending cap, extra funding selection, live monitoring or wallet action is enabled by this adapter.

Custom mode retains the controls described below, including its historical zero-outside-weight fallback.

## Custom scenario initialization

The user requested complete forecast inputs from public chain reads, with valid fallback values. This changes scenario initialization, not published game rules or transaction authorization. The Almanac remains the gameplay source of truth; cached rule constants are unchanged.

Opening Yield forecast reads the season once without using a wallet provider. Related reads, including pool pricing, are pinned to one block. A usable observation must match the cached Genesis and be no older than five minutes by both block time and retrieval time. Missing or invalid values keep the corresponding fallback; carry, Granary and start are one inseparable observation group. Saved and in-progress edits are preserved unless the visitor presses **Use chain defaults**.

| Input | Chain source | Fallback / interpretation |
| --- | --- | --- |
| Start | Reserve block timestamp | Current UTC time, or Genesis before launch. Never reuse observed reserves at an unrelated date. |
| Additional valley weight for funding limits | Post-Genesis planted weight, minus watched holdings | Zero additional weight when unspecified; no full-collection planting default. This is a rate scenario, not a future participation observation. Model plots do not reduce observed network weight; saved watched weights from another block are explicitly estimates. |
| Known weeks | Reviewed WeatherOracle scheduling events and matching epoch getters at one block | Dated September 14 cache: only launch week 1 Sunny. Absolute Genesis epochs survive rebasing; early scheduled values remain mutable. |
| Unrevealed weather | Future values cannot be read from the commitment | Fair (1×), editable. Getter inheritance is not an announcement. Whole-term Weather lab scenarios explicitly opt out of known weeks. |
| Yearly valley weight growth | Not observable for a future year | 0%; the selected additional valley weight stays constant. |
| Carry and Granary | Both reward-reserve getters at one block | Before Genesis: published zero carry and 40M CROP Granary. After Genesis: conservatively zero opening carry and Granary. Partial reserve reads cannot mix an observation with a fallback. |
| CROP buy/sale ETH reference | Active configured CROP/WETH pool's fee-adjusted spot price | Seed-bag ETH price / 2,500 CROP. Use the fresh bag price if positive, otherwise the published opening 0.001 ETH, giving 0.0000004 ETH/CROP. This is labeled a planting-cost estimate, not a market or executable quote. |
| Term | Visitor choice | 90 days; all 7/30/90/365-day comparisons and custom terms remain available. |

Operation fees are still explicit inputs to the advanced active plan; initialization does not silently declare transactions free. Buy/sale references do not include trade-size impact, route selection, gas or future price changes. The adapter never drafts a swap or adds an execution target.

## Pool evidence

Source `forecast-pool-2026-09-13` archives public RPC evidence in [the dated snapshot](snapshots/forecast-pool-2026-09-13.json). At Robinhood Chain 4663 block **61,711,122**, timestamp **2026-09-13 05:33:16 UTC**, the published pool had token0 WETH, token1 CROP, 18 decimals each, a 10,000-pip (1%) fee and **zero active liquidity**. Its stored price was therefore not accepted as an active market reference. The same observation reported a 0.001 ETH seed bag, Sunny for scheduled Genesis epoch 0, zero planted weight/carry and 40M CROP Granary. These are historical observations, not current quotes or immutable forecasts.

The official client configuration is the pool-address source. WETH identity was observed through the pool and token getters; native wrapping/redemption was not audited. Reads require the configured pair in either order, 18-decimal tokens, deployed pool code, a positive initialized square-root price, an unlocked pool and positive active liquidity. Changed or unavailable data falls back visibly.

The read interface and price arithmetic follow the primary [Uniswap V3 pool state interface](https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/interfaces/pool/IUniswapV3PoolState.sol) and [immutables interface](https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/interfaces/pool/IUniswapV3PoolImmutables.sol): `sqrtPriceX96` is the Q64.96 square root of token1/token0 and fees use millionths. This establishes interface semantics, not a full audit of this deployed pool.

## Model farm randomization

Random draws use the cached published rarity counts: 2,475 Common, 660 Fertile, 165 Prize and 33 Golden. Each batch samples without replacement; separate batches are independent hypothetical scenarios. Selected level and planting state apply to every generated plot. Model IDs remain placeholders, never a prediction of a token's eventual rarity or proof of mint ownership.

September 14 revision replaces the September 13 current-epoch weather initialization, which carried one ordinary weather assumption over the whole term. Evidence: [launch weather](snapshots/launch-weather-2026-09-14/SUMMARY.md). The original pinned pool/weather observations above remain historical facts.

September 15 revision: [the current Almanac and unchanged runtimes](harvest-rate-2026-09-15.md) confirm that own weight defines the nominal rate. The former automatic full-supply fallback is removed in version 2.9; it remains available only as an explicit advanced harvest-limit scenario. Annual ceilings, carry and finite Granary are retained.
