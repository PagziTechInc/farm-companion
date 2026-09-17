# Research answers and remaining dependencies

The Almanac remains the gameplay source of truth. The [verified contract review](contract-review.md) adds targeted implementation evidence and flags conflicts with published promises. See [questions.json](questions.json) for searchable answers. Review date: September 7, 2026.

## U01 — Weather events and commitments

**Event behavior source-verified.** Almanac stacking is confirmed: a covering Flood doubles the weekly multiplier, a covering Moon doubles it again, then the total is capped at 2×. Flood lasts 24 hours and Moon 48 hours; distinct kinds may overlap. The scenario engine rejects same-kind overlapping entries as ambiguous duplicate inputs. Above-base rewards are limited by available Granary, whose depletion is not modeled by the projection.

**Material commitment conflict.** The deployed weather scheduler can replace a future scheduled epoch until its 24-hour cutoff without checking `commitHash` or a reveal preimage. A discarded owner-address `eth_call` confirmed that replacement could succeed; actual Sunny state stayed unchanged. Almanac promises remain recorded as promises, not proof of an enforced immutable forecast. Unscheduled weather carries a recent prior value within 52 preceding epochs or falls back to Fair.

## U02 — Harvest fees and gas

**Game fee and approval answered.** Almanac and source confirm zero harvest game fee, no CROP allowance, per-caller ownership and same-wallet batching. One invalid plot reverts the batch. Claims settle historical rewards and synchronize weights.

Remaining: Wallet-paid gas and sponsorship are not established by that game fee. Preparation estimates execution gas, while real receipts/payer details are still required to measure actual cost. Receipt execution gas is not automatically every fee component.

## U03 — Fertilizer and tarp

**Not yet published.** Store plans November fertilizer (+25% plot weight for a week) and a tarp (weekly multiplier floor at 1×). Final prices, activation, overlapping/transfer behavior and all per-plot effects remain unavailable. Cosmetics have no established yield boost. No supply purchase recommendation can be completed yet.

## U04 — Reveal timing

**Deadline source-verified.** The immutable deadline is September 18, 2026, 18:00 UTC (1789754400). Permissionless reveal may occur after the required post-sellout block or the deadline, but still needs a transaction. Almanac's first-week reveal wording remains the published schedule. Date alone is not proof of reveal or finalized rarity.

At the source-review observation, supply and starting index were zero and tiers were not finalized. Actual future holdings and revealed/finalized traits remain absent.

## U05 — Weekly drawing

**Full rules still unpublished.** Almanac promises one automatic free entry per planted plot from October, so all 22 planted plots would provide 22 entries across both wallets. Ticket price, entry denominator, prize value and final windows remain missing. No paid-entry expected-value recommendation can be made.

## U06 — Accrual and Genesis

**Core implementation answered.** Source confirms four 365-day years with budgets 380M/190M/95M/95M, integer-divided per-second rates, a 1e12-precision accumulator and settlement split at historical year/weather boundaries. Good weather at claim time does not improve previously accrued rewards. Zero-weight base emissions enter the Granary; the first planter receives no prior unallocated backlog. An empty Granary limits above-base rewards to base.

The planting and upgrade functions have no Genesis or reveal gate; upgrade does not require activation. The companion follows the Almanac Genesis opening (September 21 at 00:00 UTC) as an explicit application policy. Its daily projection does not reproduce every integer floor or Granary state transition. Source availability resolves the research gap without making the simplified simulator exact.

## U07 — Team and treasury vesting

**Still partly answered.** Almanac gives treasury vesting over year one and team vesting after a six-month cliff, then two years linear. Treasury no-selling in year one is a stated policy. The broad team-cannot-sell wording does not follow from the six-month cliff alone. Separate vesting contracts were not verified in this six-contract review; no enforceable one-year team lock or price floor is inferred.

## U08 — Manifest, rarity and allocation odds

**Mapping and deployment behavior answered.** The manifest commitment matches its saved raw bytes and the Almanac uses one cyclic offset. Source reveal remaps hash modulo 3333 equal to zero onto one. Uniform weighting of all offsets remains a hypothetical model; a uniform 256-bit hash model yields a different residue-weighted distribution and does not prove hash fairness or lack of influence.

Owner-written direct tiers may change until finalization; zero can be an unset default. Trusted live rarity requires revealed positive starting index, finalized direct tiers and agreement with the committed manifest. Desired and recorded weight must also agree. Actual minted IDs/finalized traits remain future inputs.

## U09 — Interfaces and human-approved actions

**Six contracts reviewed and runtime-matched.** Sourcify v2 yielded activation, levels, emissions, weather, NFT and CROP source with exact creation/runtime match metadata. Independent pinned RPC matched the runtime hashes. Exact planting/upgrade costs, separate allowance spenders, ownership, pauses and linkages were checked. Targeted discarded simulations validated preparation paths; nonexistent-plot actions reverted as expected. Compiler and published audits were not rerun.

The shared executor restricts requests to plant, one-step upgrade and same-wallet claim, with exact allowances prepared separately. Current deployment, linkage, owner, balance, costs, nonce and simulated gas are checked before individual MetaMask approval. Minting, swaps and transfers remain manual. API data is not block-pinned and cannot override the verified state. No real action was sent during development.

## U10 — Our portfolio, capital and plan

**Awaiting mint and explicit investment inputs.** Both public wallet addresses are configured, and the latest saved reads show no owned plots. The plan remains 22, split 11 each. The historical funding check exceeded USD 100 native ETH per wallet; refresh for current balances and valuation.

The user now requests an active guided plan and actions with human approval. This authorizes the interactive module, not unattended signing or an inferred extra-investment amount. Actual token IDs, finalized rarity, an explicit extra budget, fee reserve and executable CROP quotes remain needed. The plan compares whole-portfolio marginal gains, checks whether rare-first is worthwhile, and keeps no-upgrade, CROP and ETH outcomes separate.

Evidence: [contract review](contract-review.md), [source/runtime/simulation snapshot](snapshots/execution-research-2026-09-07.json), [earlier site audit](snapshots/site-audit-2026-09-07.json), [earlier API/source-access follow-up](snapshots/api-followup-2026-09-07.json), [Almanac](https://rh.farm/almanac/), [Store](https://rh.farm/store/). Earlier explorer failures are retained as historical records; successful Sourcify v2 retrieval supersedes the claim that full game source was unavailable.
