# Economy v2 worked examples

These are mathematical examples, not holdings or future profit forecasts. The [current rulebook](rulebook.md) and [rules.json](rules.json) describe their limits; [earlier examples](history/2026-09-07/worked-examples.md) belong to the superseded economy.

## One Common plot at level 1

With enough schedule/carry and Granary, Fair weather and no fees:

| Phase | CROP/week | CROP/day |
| --- | ---: | ---: |
| September 21–28, First Soil 2× | 4,000 | 571.428571 |
| September 28–October 19, First Soil 1.5× | 3,000 | 428.571429 |
| After October 19, First Soil 1× | 2,000 | 285.714286 |

Planting's 2,500 CROP is recovered in **4.375 days** when planted at the start of the founding week under these assumptions. Rounding this up to whole days gives 5 days; it is not an exact five-day lock. A 30-day Genesis projection earns 13,571.428571 gross CROP: 4,000 in week one, 9,000 in the next three weeks and 571.428571 in the final two days. Subtract 2,500 planting to get 11,071.428571 net CROP before fees and upgrades. The same constant Fair conditions give 30,714.285714 gross over 90 days and 109,285.714286 over 365 days. Weather, competition above the cap and reserve depletion can change these results.

## Upgrade rank and funding time

A Common level 1→2 adds 0.25 weight for 5,000 CROP. A Golden level 1→2 adds 0.5 for the same 5,000. Below the cap in Fair weather without First Soil, the Golden upgrade adds 1,000 CROP/week and the Common adds 500. Their simple burn recovery times are 35 and 70 days, excluding fees and opportunity cost.

A Golden level 2→3 still adds 0.5 weight, but costs 10,000. Thus it ties the fresh Common level 1→2 on added weight per CROP, while a fresh Golden level 1→2 is twice as efficient. Rank every current step and multi-step path under its time horizon; rarity alone is not a complete instruction.

If one active Common plot is the wallet's only income, with 0 liquid CROP and 0 pending, it takes 35 days at the ordinary Fair rate to accumulate 10,000 CROP, or 17.5 days for 5,000. Starting in First Soil changes the answer at its exact date boundaries. Two independently earning identical plots in the same wallet reach the target twice as quickly under unconstrained conditions. A plot in another wallet cannot fund this wallet without a claim and transfer.

## Ceiling and reserves

Year-one base schedule per week is 380,000,000×7/365=7,287,671.232877 CROP. Divide by the 2,000 nominal rate to obtain 3,643.835616 weight units. With 4,000 farm weight, no carry and an ordinary Fair week, base payout is capped at the schedule; each weight unit receives about 1,821.917808 CROP/week. During the founding week with sufficient Granary this becomes about 3,643.835616 after the 2× soil multiplier.

For a one-week 1-weight Common example: nominal base 2,000; initial carry 0; available schedule 7,287,671.232877; final carry 7,285,671.232877. First Soil 2× targets 4,000. With Granary 500, payout is only 2,500 and Granary 0. With Granary 10,000, payout 4,000 and Granary 8,000. This shows why projected boosts cannot assume unlimited reserves.

If the farm is idle for a day, carry increases by 380M/365; Granary stays unchanged. Later planting receives no lump-sum backlog, but that carried budget can help support the nominal rate when future annual budget flow alone is insufficient.

## Capital and ETH routes

A 5,000 CROP purchase is external capital, not earned CROP. Compare end value less acquisition costs, game burns and wallet-paid fees; do not count the deposit itself as profit. Pending rewards need claiming before spending. Liquid and pending starting balances remain assets but are not new projected earnings.

At an illustrative executable buy quote 0.0000004 ETH/CROP, 2,500 CROP costs 0.001 ETH before network fees. That matches the opening seed bag's 0.001 ETH; compare approval+plant gas and quote-included costs against bag gas. The quote and bag price must both be fresh, and a user may prefer spending already owned CROP. The opening bag price is not a permanent constant.
