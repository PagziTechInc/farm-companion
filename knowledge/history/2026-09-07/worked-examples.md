# Worked examples — not actual holdings

These fixtures exercise the decision rules without assuming the user's rarities, balances or investment budget. `tools/validate_knowledge.py` recalculates the results offline with exact rational arithmetic. Rounded display values do not feed back into calculations.

## 1. A common plot's first upgrade can lose money over short horizons

Assume all 3,333 plots are already planted at level 1; our hypothetical 22 are Common. Total farm weight is 3,613.5, our weight is 22, weather stays Fair, and daily flow is 380,000,000 / 365 CROP. Assume an immediate, externally funded upgrade, no further competition changes, and no additional fees. This is a frozen-condition diagnostic, not a forecast or a harvest-funded schedule.

Baseline portfolio rate: **6,338.483351 CROP/day**. Upgrading one Common plot to level 2 costs 10,000 CROP and adds 0.25 weight. Our weight becomes 22.25 and total weight becomes 3,613.75. The **extra portfolio rate** is **71.584739 CROP/day**, with simple payback of **139.694579 days**.

| Horizon | Extra CROP after the upgrade cost |
| --- | ---: |
| 30 days | −7,852.457820 |
| 90 days | −3,557.373460 |
| 365 days | +16,128.429857 |

Using the upgraded plot's whole new harvest as its benefit would overstate the return. Ignoring the reduced shares of our other plots also overstates it. These numbers say nothing about ETH profitability without cost and sale-price assumptions.

## 2. Mixed rarities and two wallets

Hypothetical level-1 holdings:

| Wallet | Common | Fertile | Prize | Golden | Plots | Weight |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 6 | 3 | 1 | 1 | 11 | 13.25 |
| B | 5 | 3 | 3 | 0 | 11 | 13.25 |
| Combined | 11 | 6 | 4 | 1 | 22 | 26.5 |

With the same global and weather assumptions as example 1, baseline portfolio yield is **7,634.991309 CROP/day**. A first upgrade on the Golden plot adds 0.5 weight and **142.980202 CROP/day** to the combined portfolio. It beats a first upgrade on a Common plot at the same 10,000 CROP cost.

Rarity alone does not rank different steps: Common level 1→2 costs **40,000 CROP per added weight unit**; Golden level 2→3 costs **50,000 per added weight unit**. The Common step is more efficient on that measure. Complete strategy comparisons must still include prerequisites, timing, cash availability, horizon and changing farm weight.

## 3. Funding must exist in the right wallet

Suppose A has 9,000 liquid CROP and 5,000 pending; B has 2,000 liquid. A cannot pay a 10,000 upgrade from its liquid balance yet.

- Claiming at least 1,000 available pending CROP makes the token payment feasible, subject to the actual claim mechanics and fee funding.
- Alternatively, transferring 1,000 CROP from B yields A=10,000 and B=1,000. Combined liquid CROP remains 11,000 before any transfer costs. Nothing was earned by the transfer.
- Pending balances must not be counted both as liquid funding and as unclaimed terminal assets.

The funding example omits transaction costs explicitly; it does not establish free transfers or sufficient ETH. In the harvest-funded model, an action waits until a feasible claim/transfer can fund it. In the extra-investment model, externally purchased CROP must fit an explicit budget and is capital, not earnings.

## 4. Consolidation can have an activation penalty

Keeping 11 plots in each wallet is the baseline. Moving B's 11 **already active** plots to A requires **27,500 CROP** to reactivate under the published transfer rule, plus transfer costs and any lost earning time. Level, rarity and pending CROP are preserved.

Consolidation is favorable only if its measured or scenario-estimated benefits exceed those incremental costs. Moving them **before first planting** avoids losing a prior activation payment; initial planting of all 22 still costs 55,000 CROP. If harvesting is genuinely sponsored with no wallet-paid cost, fee savings from reducing claim transactions could be zero. No consolidation recommendation is currently made.

## 5. Boundary cases

- With no active weight and a positive emission rate, the old portfolio rate is zero. Once the first plot is active, it has all forward weight in the simple formula. This does not award it past idle emissions or establish pre-Genesis eligibility.
- If our portfolio owns all active weight, upgrading cannot increase its total share beyond 100%. Extra weight is not automatically extra portfolio revenue.
- Changing claim frequency does not change weight. Any compounding benefit comes from earlier feasible reinvestment, not clicking Harvest more often.
- Year four's published budget remains 95M; do not halve it to 47.5M. Never extend year-four yield indefinitely.
- Locusts 0.5× times a 2× event, capped at 2×, gives 1×. An overriding 2× event gives 2×. This demonstrates U01's significance without choosing an unverified implementation.
- Without actual plots and market inputs, actual net CROP and ETH profits remain unavailable. Templates contain `null` results, not estimates for these fictional portfolios.

Rules and sources: [rulebook](rulebook.md), [machine constants](rules.json), [unknowns](unresolved.md), [generated validation](validation.md).
