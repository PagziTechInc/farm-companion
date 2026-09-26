# Yield Farm local rulebook

**Current update: September 26.** [Planting V3, fixed first-use bags, sprouts, finalized reveal and Orchard](game-update-2026-09-26.md) supersede the older deployment, repricing and weather-owner descriptions below. Core CROP economics are unchanged.

Reviewed September 11, 2026; the own-weight formula and reveal state were rechecked September 15. The user designates the [Almanac](https://rh.farm/almanac/) as the published gameplay authority. [Current constants](rules.json), [integration addresses](integrations.json), [research answers](questions.json), and the [source review](contract-review.md) support offline decisions. Older rules are retained under [September 7 history](history/2026-09-07/rulebook.md); they must not drive current advice.

## Economy v2 changes

The game replaced its original shared annual emission stream with a nominal **2,000 CROP per weight unit per week**, bounded by the schedule and carried unused budget. New planting, CROP, levels, emissions and NFT deployments replace the September 7 addresses. Weather stays at its earlier address.

First Soil multiplies every planted plot from Genesis: **2× September 21–28**, **1.5× September 28–October 19**, then **1×**. Boundaries are 00:00 UTC. The weather/event cap is applied before First Soil, so 2× weather during the founding week can give a combined 4× while the Granary can pay. Upgrade burns are now **5,000 / 10,000 / 20,000 / 50,000 CROP**; all four steps total **85,000**, plus 2,500 planting.

Seed bags now cost a fixed 0.001 ETH and apply only to a plot’s first planting. Previously planted dormant plots can use 2,500 CROP or a freshly quoted ETH sprouts payment. Both ETH routes need current per-plot eligibility and funded treasury burns. See the September 26 source review.

The current Almanac lists a **1% Uniswap pool fee paid to liquidity providers and no site swap fee**. This replaces the prior 0.5% site-fee statement. Store opening is now “later this year”; November supplies remain provisional. Reveal is explicitly due at sellout or September 18, 18:00 UTC. The treasury no-market-selling policy now explicitly excepts its published pool ceiling ranges.

## Your harvest rate

Nominal weekly harvest = **2,000 × your active weight × First Soil × weather**. Other plots planting do not dilute this rate while its funding is available. The annual base ceiling and finite Granary still apply; the current Almanac explicitly retains both. September 15 independent reads matched all six previously reviewed runtimes, so no new economic deployment was observed. See the [rate clarification](harvest-rate-2026-09-15.md).

The public calculator no longer requires other farms’ weight or assumes the full collection is planted. Optional valley weight affects funding-limit scenarios. A default zero outside-weight assumption illustrates your rate; it is not evidence of future valley participation. The displayed rate at the forecast start is distinct from term earnings across weather, soil and year boundaries.

## Exact economic model

Weight in units = level multiplier × rarity multiplier. Level multipliers are 1, 1.25, 1.5, 2, 3. Rarity multipliers are Common 1, Fertile 1.25, Prize Plot 1.5, Golden Acre 2. Dormant plots have zero earning weight. The collection has 2,475 / 660 / 165 / 33 of those rarities: all level-1 plots total **3,613.5 weight**, not 3,333.

For each segment of `dt` seconds bounded by year, weekly weather, events and First Soil changes:

```
nominalBase = 2000e18 × totalWeightBps × dt / (10000 × 604800)
available  = carry + floor(yearBudgetWei / 31536000) × dt
base       = min(nominalBase, available)
carry      = available - base
multiplier = weatherBps × firstSoilBps / 10000
target     = base × multiplier / 10000
```

All token operations use integer base units and the source floors integer divisions. If target exceeds base, payout is base plus the smaller of the requested surplus and available Granary. If target is below base, payout is target and the shortfall enters Granary. Unused scheduled base goes to **carry**, which is a different stock. **When no plots are active, schedule accrual enters carry and the Granary does not grow.**

The plot's portion is farm payout × plot weight / total weight. Claiming cannot reprice historical harvest using the weather at claim time. Accumulator rounding uses 1e12 precision; the simulator's regular planning steps cannot exactly reproduce all future transaction-timing floors. Carry and Granary are finite balances, not repeatable per-second flows.

Year budgets remain 380M / 190M / 95M / 95M over four exact 365-day years. At zero carry the year-one nominal base meets the schedule at about **3,643.84 weight units**. Below the cap, another farmer planting does not reduce your nominal yield. Above it, or as carry runs out, weight share matters. First Soil and beneficial weather come above the base cap from Granary. At the end of year four accrual stops; unused carry and Granary are sweepable subject to outstanding reward backing. A separate promised future 100M airdrop-pool sweep is not available until actually transferred.

At the review block 60,592,342, supply, total weight, emitted CROP and carry were zero; Granary was 40M CROP and emissions held 800M CROP. These are historical observations, not current balances. Use `carryNow()` and `granaryNow()` pinned to the same block as holdings for live starting balances. `farmRatePerSec()` is the **next 24-hour accrual divided by 86,400**, at current weight and scheduled weather; it is not an instantaneous rate or a multi-month forecast.

## Advice and projections

The public platform starts empty and accepts visitors' wallets or manually entered hypothetical plots. No personal target count, funding target or original owner's address is a default. Advice is computed locally with deterministic arithmetic; no AI service is involved.

Compare whole-portfolio marginal returns for each next step and useful multi-step paths. A rare plot normally adds more weight at the same upgrade cost, but later levels cost more: a fresh Common upgrade can beat the next Golden upgrade per CROP spent. With caps, include the candidate's effect on the denominator, carry use and Granary depletion. Consider no upgrade or no additional spending as valid outcomes. Report the best evaluated policy under stated assumptions, never guaranteed maximum profit.

Show gross earned CROP separately from tokens spent, purchased, pending and spendable. Purchased CROP is capital, not income. Claimable CROP can help fund an upgrade only after a claim. Time-to-upgrade uses the owning wallet's available and future earnings unless a separately costed transfer is considered. Check a horizon's actual extra earnings against the burn and fees; a higher daily rate does not by itself repay its cost.

Keep harvest-funded and extra-investment cases, net CROP and estimated net ETH, and 30/90/365-day comparisons. The public yield calculator also supports shorter views and upgrade funding time. ETH estimates require entered executable-size buy/sell quotes and fees. Optional no-fee scenarios must be labeled assumptions. Future weather, valley funding demand, deposits and prices are unknown; stress cases illustrate sensitivity and re-run policies rather than representing a fixed transaction sequence. See [worked examples](worked-examples.md).

## Wallet actions and ownership

Public addresses can be read without connecting a wallet. Standard plant and upgrades require exact CROP allowances to the current activation or levels contract. An approved allowance does not approve a later spend. Claims require no CROP allowance or harvest game fee, but network fees may still apply. Each caller can claim only its owned plots; one invalid plot can revert a batch. Never infer gas sponsorship from the zero game fee.

Every supported submission requires separate review and wallet confirmation. Prepare with fresh ownership, tier finalization, live code and links, cost, balance, allowance and simulation checks. Preserve durable pending locks until matching receipts or a proven cancellation are reconciled. Never ask for seed phrases or private keys. Minting, swaps and asset transfers remain manual unless separately implemented and reviewed.

An NFT transfer preserves level, rarity and unclaimed rewards but clears activation. Moving active plots needs another 2,500 CROP per plot or currently available ETH sprouts to earn again. Internal transfers have no documented exemption. Harvest before selling if the seller wants to retain pending rewards. Inspect recorded and desired weight after transfer; caught hook failures can leave stale recorded weight until a successful synchronization.

## Published promises versus source behavior

The unchanged WeatherOracle still allows replacing scheduled weeks before their 24-hour cutoff without checking `commitHash`; a commitment is not an immutable forecast. Floods double weekly weather for 24 hours, Moons for 48 hours; different event kinds can overlap, with the final weather cap 2× before First Soil. Future getter defaults can carry prior weather, so they are not proof an epoch was explicitly revealed.

The current NFT still remaps reveal hash residue zero to offset one. Uniformly weighting all 3,333 cyclic offsets is hypothetical. Source-aware odds can assume a uniform hash and apply the remap, but cannot prove hash fairness. Rarity tiers are written by the owner and remain mutable until finalization. Default zero tier is not evidence of Common. Positive reveal index, finalized direct tier, manifest agreement and synchronized weight are needed for live rarity advice.

Planting and upgrades have no source Genesis gate, but the platform follows the Almanac opening at Genesis as application policy. Seed-bag pricing, pause powers and replaceable activation are also material operational dependencies. The six-contract review is targeted; it is not a full security audit or a guarantee of solvency.

## Rules still incomplete

Provisional fertilizer adds 25% weight for one week; tarp advertises a plot-specific weather floor. Neither final price nor detailed activation/stacking behavior is known; exclude them from earned-yield advice. Cosmetics have no verified yield effect. Drawings promise one automatic free weekly entry per planted plot from October, but ticket cost, denominators and prizes must be known before paid-ticket expected value can be computed.

The fixed 2B allocation is 760M emissions, 40M initial Granary, 100M airdrop-designated pool, 200M treasury vest, 200M team vest and 700M liquid treasury. No claimable planting airdrop is assumed. A six-month team cliff does not establish a whole-year inability to sell. Bridge and executable market quotes, final supplies/drawings, fees and future state remain fresh inputs.

## September 14 launch-weather verification

The [dated evidence](snapshots/launch-weather-2026-09-14/SUMMARY.md) at chain 4663 block 62434395 confirms one launch-week announcement: Sunny for September 21–28, 00:00 UTC. First Soil 2× and Sunny 1.20× combine to a nominal 2.40× before base-ceiling and Granary constraints. First Soil then becomes 1.5× until October 19, independently of later weather. Weeks 2–12 are unannounced; getter inheritance must not label them revealed. The launch hash was present before mint but does not expose outcomes.

Public forecasts use these absolute week dates, a dated cache offline, and a chosen assumption for unrevealed weeks. Explicit whole-term weather experiments remain available. Town Hall's at-least-24h publication wording differs from the Almanac's boundary wording; the contract allows changing a schedule through its exact 24h cutoff and never validates the commitment. Later verified inherited historical weather is distinct from an announced future week.

Upgrade route comparisons sum all burns to a target level and compare whole-farm gains with no upgrading. The owning wallet's passive funding delay applies to the whole route. Guided policies may instead upgrade in stages, revisit that plot, or buy CROP within explicit price, fee, wallet balance and capital constraints. Cheap market entry does not make purchase principal income or establish a future profitable exit.
