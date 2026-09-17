# Portfolio intake and model contracts

This directory preserves the original owner’s local planning files and the historical 22-plot, two-wallet intake templates. It is not part of the public release. The public dashboard starts empty; use its wallet watcher or model-farm builder, then export a workspace JSON for the CLI. Templates do not establish current holdings.

## Populate holdings later

Copy `holdings.example.json` to `holdings.json`, mark it `is_template: false`, and fill the two **public** wallet addresses. Insert one real plot record per token into the correct wallet's `plots` array, using `plot.example.json` as the field guide. Do not add placeholder IDs 1–22. The archived public metadata for token 1 is not portfolio data.

For each plot collect token ID, reveal status, rarity, level, activation, effective weight, pending CROP, and acquisition cost/fees if known. Traits are optional supporting metadata; they do not add independent farming bonuses. Confirm modifier state when relevant. If only partial details arrive, preserve them and list what is missing.

Store amounts ending in `_wei` as decimal integer strings, including ETH and CROP. CROP has 18 decimals: `2500 CROP = "2500000000000000000000"`. IDs and BPS are integers; on-chain balances must not pass through floating point. Unknown is `null`, not `0`, `false`, Common, or an empty confirmed modifier list. Record UTC time, source and block for observations. Reconcile duplicate token IDs, conflicting owners and impossible weights before calculations.

Never put a private key or seed phrase here. Public holdings can be monitored without connecting MetaMask.

## Scenarios

`scenarios.json` records the agreed axes: 30/90/365 days; harvest-funded versus extra investment; net CROP versus net ETH; normal estimated fees versus zero wallet-paid gas; two wallets versus consolidation before/after planting. It is an input template, not completed profit output.

The launch scenario begins at Genesis. Use another explicit start date for later decisions. A future model must split accrual at changes in farm weight, weather, emissions and actions. Do not assume all future weather equals the first Sunny week. Verified source uses 365-day emission years; current projections include carry and finite Granary reserves.

Keep both wallet ledgers even when optimizing jointly. A proposed upgrade must have sufficient liquid CROP in the signing wallet; pending earnings need a claim first. A proposed transfer must subtract from one wallet and add to the other, with costs and availability accounted for. Transfer amounts are not new earnings. With extra investment, use a stated cap and quotes for the proposed trade size. Do not imply a larger budget necessarily improves net returns.

Before an actual ETH profitability estimate, provide executable-size buy/sell quotes, fee assumptions and valuation basis. Missing acquisition cost prevents complete lifetime profit accounting; an explicitly labeled incremental comparison can still be made when its own inputs are sufficient. Never assume the NFT's terminal value equals its upgrade cost.

## Return definitions for the future shared engine

**Net CROP production** is CROP accrued during the horizon less CROP consumed by planting, upgrades, supplies and CROP-denominated charges. Show earned, spent, bought, sold, pending and liquid tokens separately. Purchased tokens and cross-wallet transfers do not raise this production metric; selling earned tokens does not erase their production. Network fees in ETH remain separate unless an explicit conversion is requested.

**ETH net cash recovery** is ETH cash proceeds less associated acquisition/investment spending and fees for the specified accounting period. Keep this separate from estimated terminal asset value and from tax/accounting realized gains, which require cost-basis allocation.

**Estimated ETH net profit** adds explicitly valued ending assets to relevant cash proceeds and subtracts the declared starting basis, external investment and costs, without double-counting expenses. Specify whether the starting basis is historical acquisition cost or scenario-start value. Opening ETH is liquidity, not earned income; internal wallet transfers cancel at portfolio level. Do not subtract both the ETH purchase cost of CROP and a second ETH conversion of the same burned CROP: the token outflow already reduces ending assets. Pending and liquid CROP must be counted once each. Show token and NFT terminal values separately from cash recovered.

The engine should return missing inputs instead of values it cannot calculate. A net CROP estimate can be available while an ETH estimate is unavailable. The implemented engine calculates scenario returns once required inputs are supplied; it does not invent actual portfolio profit.

## Future interfaces

The implemented standalone dashboard and Tampermonkey panel share one engine and this rules package. The panel is restricted to `https://rh.farm/`. See [the user guide](../docs/USAGE.md). The original scenarios.json records planning axes; use a dashboard-exported workspace for the executable CLI scenario format.
