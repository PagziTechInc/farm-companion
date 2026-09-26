# Using Farm Companion v2.10.0

Farm Companion is a fan-made field journal for Yield Farm. Watch public wallets or build a hypothetical farm, forecast the harvest and find your next upgrade. Calculations run in your browser. Public wallet refreshes use PublicNode's free Robinhood RPC and the game's metadata service.

## Install the Chrome / Edge extension

1. Download **farm-companion-chrome-2.10.0.zip** (or **farm-companion-chrome.zip** from the dashboard) and extract it to a folder you will keep.
2. Open **chrome://extensions** (Edge: **edge://extensions**) and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing **manifest.json**.
4. Visit or reload **https://rh.farm/** and click **Farm Companion**.

The native extension needs no Tampermonkey or local server. Use either this extension or the userscript; disable the other to avoid duplicate launchers. For source builds, `npm run build` creates the directly loadable **dist-extension/** folder and both ZIP download paths. To update an existing unpacked installation, replace files in the same folder, click **Reload** on its extension card and reload the game. Export the farm and action journal before removing an installation.

The **farm-companion-public-2.1.0.zip** release and **dist/** are website packages, not Chrome extensions. Their `_headers` file configures website hosting; removing it does not turn the website into an extension. Use the new Chrome ZIP for **Load unpacked**.

## Open the dashboard or Tampermonkey panel

Use [farm.pagzi.tech](https://farm.pagzi.tech/) for the live dashboard. Updates publish automatically after validation; refresh the page when you want the latest version. An open tab keeps its matching planner code and is never forcibly reloaded during an action review.

The hosted site starts with its own empty browser storage. Export your farm JSON from the old dashboard and import it under **Saved farms** to move your saved farm. Action journals remain separate. Download the current [Chrome extension](https://farm.pagzi.tech/farm-companion-chrome.zip) or [Tampermonkey userscript](https://farm.pagzi.tech/yield-farm-companion.user.js) from the same host; update installed plugins separately.

For local use, install Node.js 22 or newer and run:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4173**. The development server serves application files only and binds to this computer. Set `FARM_PORT` for another port; stop with Ctrl+C. `npm run build` produces a generic `dist/` directory suitable for a static HTTPS host. It does not embed anyone's local portfolio or wallet addresses.

For Tampermonkey, install the complete generated `dist/yield-farm-companion.user.js`, also available from **http://127.0.0.1:4173/yield-farm-companion.user.js** while the server runs. Visit **https://rh.farm/** and click the **Farm Companion · Open field journal** launcher. The panel has the same tools as the dashboard and needs no localhost server after installation. Browser or extension policy may require enabling userscript execution.

## Quick start

Click **Connect wallet**, or paste a public address and choose **Add wallet**. Harvest and upgrade paths calculate automatically. Choose **1 week**, **1 month**, **3 months** or **1 year** to update both views. Dormant plots are assumed planted for these estimates; their real status stays visible and their planting capital is separate. Opening rates include known weather and First Soil.

**Upgrade planner** starts with next-level comparisons; **Full paths** compares every cumulative route. **Build active plan** uses prefilled price and gas estimates. Extra purchases still need your explicit cap, and every real transaction needs its own review and wallet confirmation.

Open **Estimate details → Custom scenario** only to override assumptions. Previously saved custom scenarios stay intact; **Use automatic estimates** switches back. The detailed controls documented below apply to custom mode. **Try a model farm** and the extra calculators are collapsed by default.

## Navigation

The three main tabs stay in view. **Tools** contains **Themes**, **Valley** and **Saved farms**. **Actions** stays directly available. Each opens one tool at a time; choose a main tab or **Back** to return. Long galleries and tables scroll inside the workspace. On phones, forecast and active-plan settings fold away after calculation; **Edit forecast** or **Edit plan settings** opens them again. Unsubmitted form inputs survive switching tools during the session.

## 1. My farm

Use **Watch a wallet** to add a public address and optional label. **Add & refresh wallet** reads its plots and balances; **Refresh wallet data** updates watched wallets again. Tracking requires no MetaMask connection. Reads show their UTC time and block; unknown or unrevealed traits remain unknown.

If the collection has revealed but earning tiers are still pending, refresh wallets to unlock a **Revealed-trait preview**. It uses the verified committed traits for forecasts and upgrade comparisons while preserving the actual holdings. **Assume all planted** previews dormant plots with planting funded separately; the displayed planting cost is excluded from gross harvest. Active investment plans wait for finalized on-chain tiers. Temporary RPC throttles and connection failures retry automatically; artwork failures do not block economic reads. If a refresh remains incomplete, the previous wallet snapshot and its original timestamp are kept. Retry refresh before using an active plan.

Use **Build a model farm** to choose a count, rarity, level and planting state without owning plots. Model wallets and plots are clearly labeled hypothetical. Edit their balances, pending rewards and traits to explore alternatives. Watched plot details come from chain and are not editable in this form.

Plots appear as illustrated cards with rarity, level, planted status, weight and unclaimed CROP. Switch to **List** for a compact inventory, or **Show more plots** to expand the gallery. Built-in showcase images are labeled **Example art**. Enable **Load plot artwork** above the inventory to load each visible token’s image from the selected Production or Rehearsal source. This setting is independent of your chosen theme; it is saved with the farm. Artwork loads a page at a time, with up to three requests running together. If the API or an image fails, the card keeps a labeled example and **Retry artwork** can try the read again. Once the farm has plots, use **+ Add plots** for intake and **Wallets** to refresh or edit wallet balances.

Search the inventory directly; open **Filters & sort** to choose a wallet, planting state or sort order, then **Apply filters**. After calculating a forecast, cards also show **CROP · day one** and earnings across the selected term. Day one starts at your forecast's selected UTC start; it is not a live yield read or a claimable balance. **Plan upgrade** pins an eligible planted plot as your target and opens the upgrade planner. Filters only change the view; calculations still include the entire entered farm.

Open **Themes** to choose **Field journal**, **Original field**, **Deep Winter**, **Festival Night**, **Autumn Gold** or **Storm Watch**. Your selection changes the full companion palette—backgrounds, panels, navigation, controls and accents—as well as the main illustration, across all three tabs and the action panel. Your choice is saved with the farm; it does not buy a game skin, change weather or affect income.

**Explore plot themes** opens the plot studio, initially at token **331** or your previously selected plot. Enter any **Plot number** from **1–3333** and click **View plot**, or use the previous/next arrows. The studio shows that token’s revealed image and display traits. **Use this plot’s theme** makes its artwork and a matching visual palette your companion theme. Choosing another built-in scene switches away from the plot theme. This works before adding any wallets or plots.

Press **Play animation** to open the game’s animated scene. **Pause animation**, closing the studio or viewing another plot stops that embedded scene. **Open animation** opens the same source in a separate browser tab; close that tab separately when finished. Animation does not start automatically.

**Production** is the default source. Before reveal, the studio shows **Waiting for reveal**. Select **Rehearsal** to explore the testing artwork. Displayed level, planted status and animation counters do not update your farm’s holdings, rarity or projections. Your selected plot theme is checked again when importing a saved farm.

Open **Valley** for weather and the calendar. **Around the valley** shows public game conditions when you click **Check the valley**. No wallet connection is needed. The read displays its UTC time and chain block, weather plus events, mint progress, planted weight, Granary and the current seed-bag quote. A saved snapshot stays dated; partial or failed reads remain visible. Checking the valley does not rewrite your forecast assumptions, and weather scheduling can change before its cutoff.

The calendar beside the weather desk follows the published Almanac dates for mint, reveal deadline, Genesis and First Soil changes. **Save calendar** downloads a local `.ics` file with UTC events. Dates and countdowns describe the published schedule; they do not confirm that minting, reveal or any transaction has happened on-chain.

A workspace supports **1–20 wallets and up to 100 plots total**. You can analyze any complete subset of plots; there is no 22-plot or two-wallet requirement. IDs must be unique within the workspace, including model IDs. Refresh failures and conflicting live traits must be resolved before they can support a forecast.

Liquid CROP and unclaimed CROP remain separate. Pending rewards cannot fund a transaction until claimed. Hypothetical balances do not establish ownership or authorize an action.

Choose **Random · collection mix** under **Build a model farm → Rarity** to draw a hypothetical batch using the published Common/Fertile/Prize/Golden counts. Every plot keeps your selected level and planting state. The random batch samples without replacement; it does not predict your eventual token traits or mint allocation. Fixed rarity choices remain available.

## 2. Yield forecast

Opening **Yield forecast** fills the inputs and checks the public chain once, without connecting a wallet. Fresh observations fill weather, reward reserves and the valley weight used to check funding limits. Your nominal rate is **2,000 CROP/week × your active weight × First Soil × weather**. You do not need to enter anyone else's weight. Custom fields stay unchanged; **Use chain defaults** explicitly resets them.

Choose a UTC start, a term from **1–365 days** and the weather assumption. **Your harvest rate** shows the formula and hourly, daily and weekly nominal rates at the forecast start. Those are rates at that moment; the term forecast integrates changing weather, First Soil, year boundaries and available funding. A Common level-1 plot in the Sunny Founding Week has a nominal rate of **4,800 CROP/week**. Dormant plots earn zero.

Use **1 week**, **1 month**, **3 months** or **1 year**, then **Calculate forecast**. The output compares **7, 30, 90 and 365 days**, plus your custom term. If the annual base ceiling or Granary limits that forecast, a notice identifies the constraint.

Expand **Harvest limits** only when you want to inspect or change valley weight, its yearly growth, opening carry, Granary or optional CROP prices. Missing outside weight means zero additional valley weight in the scenario; it does not establish future participation. **Full collection at level 1** remains an explicit stress assumption, and observed valley weight can inform the funding check. Neither changes the nominal per-weight formula. Saved explicit assumptions remain intact.

A fresh chain read copies both reserves together and aligns the start to their block time, or Genesis before launch. If unavailable, defaults use Fair for unknown weeks, zero outside weight/growth, and zero carry. Granary defaults to the published 40M before Genesis and conservatively zero afterward. Valid observed post-Genesis valley weight is used for ceiling and bonus-funding checks. Buy/sale prices use a fee-adjusted active-pool reference when available; otherwise they use labeled seed-bag planting parity, not an executable market quote. Editing reserves or their start changes them to assumptions; observed balances cannot be replayed at an unrelated date.

The revised reward model includes:

- A nominal **2,000 CROP per week per weight unit**, limited by available annual release plus seed carry.
- First Soil: **2× from September 21–28, 2026**, then **1.5× until October 19**, then 1×.
- Weather and event multipliers, with bonuses limited by the finite Granary.
- Carry accumulation, Granary depletion/replenishment and the four-year schedule end.

The base forecast keeps current planting and levels fixed. It does not automatically plant dormant plots or reinvest rewards. The chart and table show newly earned CROP and ending liquid-plus-pending CROP; opening holdings are counted once. Optional ETH value is the estimated gross value of new rewards at your supplied price, **before fees and capital costs**, not realized profit. Use **Export forecast CSV** to save the table.

Choose **Weather lab** above the forecast result to compare the selected term under Locusts, Drought, Fair, Sunny and Rain. Each card reruns the same farm, harvest-limit assumptions, events and opening reserves with that weekly weather throughout the term. The shared model applies finite carry and Granary; a weather multiplier alone is not a guaranteed harvest multiplier. Click a sky to apply it and recalculate. These are alternative assumptions, not predictions of the next weather roll.

Choose **CROP goal** above the forecast result. **Your CROP goal** tracks a desired **total CROP balance** for one wallet. Choose the wallet and amount, then **Track goal**; the 5k/10k/20k/50k shortcuts fill next-level costs. Progress counts current liquid CROP plus existing pending CROP once, then passive future harvest, without pooling other wallets or assuming spending and upgrades. The date is measured in whole days from the forecast start, looking up to 365 days ahead. Pending and newly earned rewards require a claim before spending; the goal does not check ETH fee funding.

If your farm contains dormant plots, choose the **Planting** forecast view. **Compare planting payments** shows the 2,500-CROP route against the latest observed native ETH seed-bag price. Use your own CROP buy quote for an executable-cost comparison; the automatic planting-cost estimate only supplies a scenario reference. The bag price is mutable, and the displayed comparison excludes operation gas.

## 3. Upgrade planner

Calculate a forecast first. The planner compares each plot's next upgrade by additional whole-farm CROP earned per CROP spent. It shows upgrade cost, additional daily yield, time to afford, CROP payback and net CROP over your selected term. A cheaper step on an ordinary plot can outperform a later step on a rare plot.

The featured next move shows wallet funding progress and the estimated gain after waiting. Expand **Levels & costs** for the five-stage **Upgrade trail**, which illustrates levels and their costs; it is a visual reference and does not initiate an action.

**Upgrade target** lets you pin a specific eligible plot. Selecting a target also fills that plot's next upgrade cost and wallet into the CROP goal. Its funding estimate stays visible while the planner continues ranking every plot by return. A pin expresses your preference; it does not override the best-return comparison or prepare a transaction. Choose **Follow the best return** to clear it.

**Time to afford** uses only that plot's wallet: liquid CROP, existing pending rewards and future yield from its currently planted plots. Other wallets' balances are not silently pooled. A claim is required where the timer relies on pending rewards. The timer assumes you do not spend those funds elsewhere and does not establish that ETH covers network costs.

The two net-return columns answer different questions: upgrading immediately, and upgrading after its wallet has earned enough CROP. **Next upgrade this wallet can fund** must still repay its token cost within the selected term after the waiting period. If no candidate does so, the planner does not invent a profitable action. Waiting/payback dates beyond 365 days remain unavailable.

Rows are independent alternatives, not an executable sequence. Recalculate after changing a plot or spending funds. Payback excludes gas and NFT resale value. Use **Export upgrade CSV** for the ranking. All advice is deterministic local code; it does not promise maximum future profit.

### Active guided profit plan

Open **Upgrade planner → Active plan**, or **Open active plan** on My farm. Upgrade ranking remains available beside it.

1. Add watched wallets or create model plots. Set weather in **Yield forecast**. Optional harvest-limit assumptions use valley weight only for the annual base ceiling and Granary funding; the active plan can read that context from refreshed wallets. Future weather, valley growth and prices remain assumptions.
2. Choose **30, 90 or 365 days** (any whole term from 1–365 works), **Harvest-funded** or **Extra investment allowed**, and rank by **Net CROP** or **Operating ETH**.
3. Expand **Plan assumptions**. Enter all six operation fee estimates, or explicitly select the zero-fee scenario. ETH ranking needs a positive net exit price. Extra investment also needs a positive all-in buy quote and total extra ETH cap. Enter manual extra purchases under **Already used from cap** before continuing; wallet refreshes do not infer this spending or reset it. The cap does not provide ETH to a wallet.
4. **Save & build plan** compares complete upgrade paths, no upgrades and keeping current holdings. Review the empty-Granary, Locusts and lower-exit-price stress cases and the upcoming ledger. The strongest evaluated policy may be to hold. Rarity alone does not decide the next step.
5. **Start live plan** enables public reads and local rebuilding while the companion is open and visible. It pauses reads during form editing, an action review or an unresolved transaction. **Pause live plan** cancels calculation and disables monitoring. No MetaMask request happens from monitoring.
6. **Review next action** refreshes holdings again and checks that the same step is still eligible. It opens the existing Farm actions review. Connect the indicated watched account, inspect costs and choose **Request MetaMask approval**. Every allowance, plant, upgrade and claim requires its own submission and confirmation. After checking a receipt, the companion refreshes and rebuilds; an allowance never submits the upgrade automatically.

Only watched wallets enter a live plan; any model plots alongside them are excluded and counted. A model-only plan remains hypothetical. Missing inventory, unfinalized rarity, partial reads, changed contract rules, stale observations or changed assumptions block action guidance. The next step can be a funding shortfall or a manual CROP purchase/transfer; these are handoffs, not automatic trades. Native ETH seed-bag planting remains a separate action option; the policy engine models the CROP planting route.

Watched plans refresh carry and Granary at the observation block and start from current time, without rewriting the ordinary forecast. Claims use a saved per-wallet cadence anchor so refreshing does not restart the waiting period. A confirmed claim receipt advances that wallet's anchor to the time you checked its receipt. Unknown external claims are not inferred from balance changes; fresh pending rewards are always checked before review. Daily action timing and contract accumulator rounding remain approximations.

Plan settings, cadence anchors and the used investment cap are saved locally. Imported farms start with live monitoring paused. Calculated results never become trusted action drafts on import or reload. **Export active plan** saves the current inputs, comparison, ledger and recent rebuild history for review. The website and each plugin keep separate settings and action journals.

Production endpoints are configured. Revealed artwork becomes available after valid responses arrive; artwork never establishes holdings or earnings.

## Optional wallet actions

Choose **Actions** in the top toolbar. Supported actions are:

- Plant one owned plot with 2,500 CROP.
- Plant one owned plot with the current native ETH seed-bag price.
- Upgrade one owned plot by one level.
- Claim the selected wallet's plots with observed pending CROP.

1. Add and refresh a real public wallet. Connect that configured account in MetaMask and switch to Robinhood Chain, chain ID **4663**, if needed.
2. Select the action and wallet/plot, then **Prepare transaction**. Preparation reads current state, validates the reviewed deployment and ownership, checks funds/allowances and simulates the call. It does not submit anything.
3. Review the wallet, contract, plots, CROP/ETH payment and gas estimate. **Request MetaMask approval** requests exactly one transaction. Drafts expire after 90 seconds and changed state requires another review.
4. If CROP allowance is missing, first approve the exact amount. After that receipt, prepare and approve the actual planting or upgrade separately. An allowance never automatically triggers a spend.
5. Use **Check transaction** to verify the receipt, then refresh and recalculate from the resulting state.

Native bag planting needs no farmer CROP allowance. Its current price, availability and backing are checked during preparation; a price change requires a new review. A successful simulation is not a profitability assessment. MetaMask displays the final network fee estimate. Minting, swaps and token/NFT transfers remain outside this action panel.

The app follows the published Genesis opening for planting and upgrades. This is an application policy; the reviewed contracts permit some earlier calls. No seed phrase or private key is requested or stored, and no real transaction was submitted during development.

## Save, import and recover

Open **Saved farms** to export/import farm JSON, download the browser plugins or reset the local farm. JSON contains plots, public addresses, balances and assumptions, so review it before sharing. Imports are validated before replacement and limited to 5 MB. The website, Tampermonkey panel and native extension have separate storage; export/import moves farm data between them. They do not synchronize automatically.

Farm exports also preserve your theme, any selected plot’s validated artwork, the separate inventory-artwork setting, CROP goal, pinned plot and last dated valley snapshot. Inventory filters and sorting are temporary view settings. Existing version-2 farm exports still load, with default companion preferences where those fields are absent.

Actions have a **separate local journal**. Export it from the action panel. A farm export does not replace that journal, and resetting a farm cannot erase an outstanding transaction lock. Use only one tab/interface for execution at a time.

If MetaMask rejects a request before broadcasting, you can prepare a new review. If submission is ambiguous or has no hash, the lock stays: find the transaction in MetaMask activity and use its hash for receipt recovery. For a speed-up or cancellation, open **Speed-up or cancellation recovery** and check the replacement hash. Only a matching canonical receipt that consumes the same wallet nonce clears the lock; cancellation is not recorded as completing the game action.

An imported compatible pending action is retained and can be adopted into empty action storage for receipt recovery. Conflicting existing and imported locks block further actions. Records for an earlier, no-longer-reviewed deployment cannot be assumed complete or resubmitted as current actions: preserve the original export and reconcile using the original transaction evidence/interface. Old personal workspace data is not automatically loaded into a fresh public installation.

## Advanced CLI analysis

The public browser emphasizes fixed-holdings forecasts and independent upgrade alternatives. The shared advanced engine remains available through the CLI:

```sh
npm run analyze -- --demo --output artifacts/demo-comparison.json
npm run analyze -- --workspace exported-workspace.json --output artifacts/report.json
npm run analyze -- --workspace exported-workspace.json --refresh --output artifacts/current-report.json
npm run monitor -- --workspace exported-workspace.json --output artifacts/latest.json --interval 30
node tools/season.mjs --output artifacts/current-season.json
```

The demo is explicitly fictional. Analysis uses the exported portfolio and saved assumptions. `--refresh` and monitoring require a workspace suitable for public wallet reads; manual models can be analyzed without refreshing. The monitor rereads the file, refreshes public state and atomically updates its report until Ctrl+C. It installs no daemon and never signs. Public wallet refresh remains manual unless the active plan is enabled; opening the forecast separately reads public default inputs once.

CLI reports retain harvest-funded and extra-investment strategies, CROP and ETH objectives, 30/90/365-day comparisons, no-upgrade and hold alternatives, action ledgers and current-time guided diagnostics. Complete upgrade paths are evaluated under several policies and budget fractions; the output is the best evaluated candidate, not a global optimum.

For advanced investment strategies, edit the exported scenario to supply an explicit `feeMode` and all six operation estimates (`claimFee`, `upgradeFee`, `plantFee`, `transferFee`, `buyFee`, `nftTransferFee`), or deliberately use the labeled `zero` fee scenario. Priced purchases also need per-wallet ETH; extra investment needs a positive buy quote and explicit `extraBudget`. `allowTransfers`, `includeOpeningCrop`, dated weather/weight paths and a two-wallet consolidation comparison remain advanced scenario inputs. The public form does not expose every CLI setting; submitting its simple forecast form resets dated paths and keeps the wallets separate.

CLI refreshes do not rewrite future prices, weather, harvest-limit or reserve assumptions; the public active plan refreshes its own observed reserve inputs. A stale observed reserve timestamp can therefore make a current-time guided diagnostic unavailable until the assumptions are refreshed or explicitly relabeled. Advanced planting simulations use the CROP route; seed-bag payment comparison and approval are available separately in the public interface.

## Evidence and limitations

The cached rules were reviewed on **September 11, 2026** against the [Almanac](https://rh.farm/almanac/) and the six current core contracts. See [the local contract review](../knowledge/contract-review.md) for deployment changes and differences between published promises and source behavior, including mutable weather scheduling, reveal-offset mapping and pre-finalization rarity control.

Forecasts model finite carry and Granary, but daily decisions and integer rounding can differ from the contract's eventual accumulator updates. Future weather, valley funding demand, deposits, token prices and liquidity remain assumptions. Temporary supplies or unsupported modifiers need confirmed rules before dependent recommendations. See [ARCHITECTURE.md](ARCHITECTURE.md) and [TESTING.md](TESTING.md) for implementation and verification details.

## Founding week and upgrade routes

Forecasts start with **Use known weeks** enabled. Week 1 uses the saved Sunny announcement; open the 12-week calendar for dates and provenance. Chain refreshes replace the announced list. **Weekly weather** applies to unrevealed weeks; choosing a sky in Weather lab models that weather throughout instead. First Soil follows UTC dates automatically. The nominal founding-week boost is ×2.40, subject to base-ceiling and Granary limits.

Upgrade ranking opens **All upgrade routes**, including consecutive levels on the same plot. Routes rank by net CROP over your chosen term; the highlighted recommendation accounts for its wallet's funding wait. **Next level only** retains the return-per-CROP comparison. Each row is an alternative, not a combined spending plan. **Build active plan** compares staged policies that can revisit a plot. For early market purchases choose **Extra investment allowed** and enter buy/exit prices, fees and an ETH cap under Plan assumptions. Swaps remain manual; record capital used before rebuilding.

The gallery shows 23 plots and places **Show more** in tile 24. Each click reveals up to 23 more. Table view offers the same page size.

## Reveal watch

Open **Valley → Reveal watch** for collection progress. Mint progress is shown separately from collected revealed assets. The hosted watcher runs while your browser is closed. It checks for a verified chain reveal every 30 seconds, then collects valid production metadata for plots 1–3333 with paced requests and retries. Placeholder or incomplete assets stay pending, and restarts retain progress. **Refresh** checks its current status; the catalogue download appears once assets have been collected.

In **My farm**, enable **Load plot artwork** with **Production** selected. Pending visible artwork retries as the collection count grows. The studio also defaults to Production; choose Rehearsal for testing themes. Previously saved rehearsal themes remain available. Public wallet refresh and the opt-in active plan still provide the economic state.

## September 26 update

The planting panel supports first-use seed bags at a fixed 0.001 ETH and fresh-quote ETH sprouts for previously planted dormant plots. Refresh holdings to see eligibility. Each operation still needs its own review and wallet confirmation; CROP approvals stay exact. Old-registry pending transactions can be recovered but cannot be drafted again.

Tools → Valley includes the Orchard guide and official reward records. AAPL rewards use actual earning-week production and are excluded from companion profit estimates.
