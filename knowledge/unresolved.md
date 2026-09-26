# Research answers and remaining dependencies

**Current update: September 26.** [Planting V3, fixed first-use bags, sprouts, finalized reveal and Orchard](game-update-2026-09-26.md) supersede the older deployment, repricing and weather-owner descriptions below. Core CROP economics are unchanged.

Reviewed September 11, 2026. The [Almanac](https://rh.farm/almanac/) controls published gameplay; the [current contract review](contract-review.md) records source behavior and conflicts. Earlier answers remain under [September 7 history](history/2026-09-07/unresolved.md).

September 15 follow-up: reveal is observed, but earning-tier finalization remains pending at block 64,012,808. See [pending rarity and forecast previews](pending-rarity-2026-09-15.md). Refresh chain state before treating any manifest-derived tier as a finalized earning multiplier.

## U01 — Weather and First Soil

**Source verified; commitment conflict.** Weekly weather and overlapping Flood/Moon effects cap at 2×. First Soil then multiplies that result by 2× for the first week and 1.5× for the following three weeks. Available Granary limits the combined surplus. Accrual splits at weather, event and soil boundaries.

Remaining: Weather remains replaceable before its 24-hour cutoff without commitment verification. Future weather, events and funding are unknown; early scheduled values are observations, not immutable forecasts.

## U02 — Harvest fees and gas

**Game mechanics source verified.** Almanac specifies zero harvest game fee and no token approval. Reviewed claim/claimMany code confirms owner checks, historical settlement and a CROP transfer with no token approval or separate game charge. claimMany loops claims within one transaction; one invalid ownership or pause check reverts the batch.

Remaining: Ordinary transaction execution does not establish zero wallet-paid network costs or sponsorship. Public eth_call and eth_estimateGas work, but actual fees and payer need fresh estimates and eventual receipt evidence. Keep zero-gas assumptions explicit.

## U03 — Fertilizer and tarp

**Not yet published.** Store still plans November supplies: fertilizer adds 25% weight for one week; tarp floors a plot’s multiplier at 1×. Cosmetics are removable and resellable; no earning boost is stated.

Remaining: Final supply prices, mechanics, transfer and overlapping effects are not published. Store explicitly calls current prices and supplies provisional. No purchase recommendation can be completed yet.

## U04 — Reveal timing

**Published and source deadline agree.** The current Almanac says sellout or September 18 at 18:00 UTC; the current NFT revealDeadline remains 1789754400. Mint opens September 15 at 17:00 UTC. Reveal and tier finalization require transactions.

Remaining: At block 60592342 the new NFT had supply 0, startingIndex 0 and tiersFinalized false. Current visitor holdings and confirmed rarity must be read fresh; a date alone proves neither.

## U05 — Weekly drawing

**Final rules unpublished.** Every planted plot receives one automatic free weekly entry from October. Entries follow actual planted counts across all wallets. Ticket CROP burns and prizes are constrained by ticket funding.

Remaining: Final ticket prices, entry denominators, eligible windows and prize values are unknown. No paid-ticket expected profit is invented.

## U06 — Economy v2 accrual and Genesis

**Changed source verified.** The nominal rate is 2,000 CROP per weight unit per week, with 380M/190M/95M/95M annual base ceilings over four 365-day years. Per segment, base is the smaller of nominal earnings and elapsed schedule plus carry. Unused schedule carries forward. Apply weather times First Soil after the cap; Granary covers surplus or collects shortfall. Idle farm schedule enters carry, not Granary. Genesis remains September 21, 00:00 UTC.

Remaining: A projection needs starting carry and Granary; carryNow and granaryNow provide current views. farmRatePerSec averages the next 24 hours of accrual. Forecasts depend on future weight, weather, deposits and transaction timing. Exact accumulator floors can differ.

## U07 — Team, treasury and token allocation

**Partly answered.** Almanac retains a six-month team cliff then two-year linear vesting, year-one treasury vesting and 2B fixed supply. Treasury no-market-sales policy now explicitly excepts pool ceiling ranges converting treasury CROP into ETH held in the pool. A separately reviewed airdrop contract has a March 1, 2027, 00:00 UTC deadline and the new emissions sink; sweep is permissionless strictly afterward.

Remaining: Team/treasury vesting and pool contracts remain outside the review. Do not infer a one-year team lock or price floor. Airdrop sweep requires a transaction and available balance. The nonzero Merkle root permits valid proofs; the site statement that nobody has a claim was not independently established, and no visitor allocation is assumed.

## U08 — Manifest and rarity odds

**Current deployment mapping verified.** New NFT 0x481ba120a6632714d8c872d1f4b6b57c8769dc21 has the same manifestHash as saved bytes. Cyclic reveal still remaps hash residue 0 to offset 1. The owner assigns tiers until finalization; tier writes do not synchronize weights.

Remaining: Positive index, finalized tier and manifest agreement are needed for actual rarity. Uniform hash remains a model assumption. Imports must identify the NFT deployment; an old token ID does not establish ownership of that ID in the new contract.

## U09 — Deployment and human-approved actions

**Current six core contracts reviewed.** NFT, CROP, activation, levels and emissions addresses changed; weather did not. Six current Sourcify exact-match sources matched pinned RPC runtime bytes at block 60592342. CROP plant, upgrade and claim interfaces persist with new costs. Seed bags add payable plantWithBag(uint256), exact current bagPrice and a town-funded burn.

Remaining: No compiler reproduction, full security audit or live transaction was performed. Minting, swaps, store, vesting and drawing execution remain outside this review. Exact allowance is not follow-on spend permission. Changed code or wiring must block drafts.

## U10 — Public portfolios and programmatic advice

**Public platform authorized.** The platform now serves any visitor: an empty default workspace, entered wallets and plots, locally computed projections, marginal upgrade advice and time-to-funding. No AI or paid model calls are needed. The original owner portfolio is private historical data, never a public default.

Remaining: Each visitor supplies their holdings or public addresses, investment limits, quote and fee assumptions, and scenario conditions. Manual hypothetical plots are not ownership proof; importing data never authorizes a transaction.

## U11 — Seed bag and fee revision

**Published and source verified.** The optional ETH seed bag opens at 0.001 ETH and burns 1,500 treasury CROP. Its current contract price is capped at 0.01 ETH and sales can be closed by the owner. CROP planting remains 2,500. Upgrade steps are 5,000/10,000/20,000/50,000. Current Almanac lists a 1% pool fee to liquidity providers and no site swap fee.

Remaining: Daily market repricing is an operational promise: there is no enforced price oracle or daily update interval. Read bagOpen, bagPrice, treasury CROP balance and allowance freshly. Compare an executable CROP quote plus fees with the bag total, without treating opening price as permanent.

Evidence: [dated site archive](snapshots/site-2026-09-11/index.json), [current source/runtime and reserve observations](snapshots/verified-contracts-2026-09-11/review.json), [separate airdrop review](snapshots/airdrop-2026-09-11/review.json), [searchable answers](questions.json).

September 14 update to U01: the pinned full event history and private mapping show only epoch 0 Sunny. Weeks 2–12 remain unrevealed despite inherited Sunny getters. Town Hall promises at least 24h notice; Almanac describes reveal at the boundary. Runtime permits replacement through the exact 24h cutoff, with no commitment proof. See [launch-weather evidence](snapshots/launch-weather-2026-09-14/SUMMARY.md). Future prices, fees, competition, liquidity and Granary deposits remain scenario inputs.


September 15 update to U04/U06: [the new review](snapshots/rate-review-2026-09-15/SUMMARY.md) matched all six runtimes at block 63958680. The own-weight nominal rate and annual base/Granary constraints are unchanged. Supply was 2290, offset zero and tiers unfinalized. Metadata now contains animation links while remaining unrevealed. Reveal eligibility at sellout or September 18, 18:00 UTC still requires a transaction; no published date or mint count establishes completion. [Calculator interpretation](harvest-rate-2026-09-15.md).
