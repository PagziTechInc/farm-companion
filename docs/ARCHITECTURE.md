# Farm Companion v2.10.0 architecture

Farm Companion ships as a static public application, a Tampermonkey panel and a native Chromium Manifest V3 extension. All three use the same local calculation and transaction modules. Calculations and farm storage remain local, with no user account or companion telemetry. A separate VPS service collects public production metadata and publishes a shared status and catalogue. An explicitly opened remote animation can load the game provider’s own fonts and beacon inside its isolated frame. Public wallet reads contact the configured chain RPC and game metadata service; those providers see the queried public addresses.

Automatic mode initializes `src/automatic-forecast.js` from the current pinned wallet snapshot and calculates after import or term changes. Its dormant planting assumption is applied only through `prepareForecastPortfolio`. `src/simple-styles.css` keeps automatic results compact; custom scenarios retain the advanced interface. The account-connect intake requests only `eth_requestAccounts` after a click. Secondary tools remain available without remounting `#approval`.

## Entry points and modules

`src/forecast-portfolio.js` prepares isolated public calculator/insight scenarios. Pending rarity may use manifest tiers only after reviewed NFT runtime, manifest commitment, positive offset and matching owned plot observation provenance. It retains false finalization flags and marks scenario copies with `forecast_preview`; transaction preparation and active plans reject either portfolio or plot markers. Optional planting assumes separate capital and reports the planting cost without debiting observed wallets. Reader warnings and cosmetic metadata errors are separate from incomplete economic reads; RPC attempts use the configured free PublicNode provider, batches of up to 20 read-only calls, two concurrent HTTP requests, 100 ms start spacing and a shared cooldown for transient failures. Browser network errors can hide upstream 429 responses; they also retry. Batch replies are matched by request ID; missing or ambiguous replies fail closed. Cosmetic metadata uses a separate bounded queue so it cannot delay remaining pinned reads. An incomplete UI refresh retains the entire previous observation instead of merging blocks.

| Component | Responsibility |
| --- | --- |
| `src/dashboard.js` | Mounts the public application with browser local storage. |
| `src/userscript.js` | Opens the same application on `rh.farm`, using GM storage and allowlisted GM HTTP requests. |
| `src/extension-content.js` | Isolated extension launcher on `rh.farm`; embeds the shared interface in an extension-origin iframe. |
| `src/extension-frame.js`, `src/extension-background.js` | Native extension storage/network adapter and restricted wallet-provider bridge; preserve the shared action review and executor. |
| `extension/manifest.json` | Manifest V3 entry points, game-only content-script matching and explicit network permissions. |
| `src/public-ui.js`, `src/public-styles.css`, `src/workspace-styles.css` | Shared Shadow DOM interface: My farm, Yield forecast and Upgrade planner; model intake, explicit refresh, assumptions and exports. |
| `src/artwork.js`, `assets/site/`, `assets/generated/` | Bundled official showcase images, source provenance and the custom companion scene. Local fonts and images require no runtime asset service. |
| `src/model-farm.js` | Samples hypothetical model batches from published rarity counts, without replacement within the batch. |
| `src/automatic-forecast.js` | Complete automatic estimates, 30% shared-limit scenario, bounded assumed fees, no mutation or execution intent. |
| `src/forecast-defaults.js`, `src/forecast-market.js` | Fresh pinned-block forecast inputs, atomic reserve provenance, conservative fallback scenarios and a read-only V3 pool reference. |
| `src/calculator.js` | Deterministic fixed-holdings projections, per-wallet rates, independent upgrade comparisons, affordability timers, planting-payment comparison and advice. |
| `src/insights.js` | Per-wallet total-CROP goal dates, plot-level harvest allocation and five whole-term weather scenarios using the shared finite-reserve model. |
| `src/farm-calendar.js` | Published Almanac milestones, First Soil phase labels and a UTC `.ics` download; no chain-completion inference. |
| `src/season-artwork.js`, `src/companion-styles.css` | Official seasonal illustrations and inline weather glyphs, scenery preferences and companion feature layouts. |
| `src/themes.js`, `src/themes.css` | Built-in scene palettes and deterministic cosmetic interpretation of plot visual traits, applied across the shared interface. |
| `src/plot-art.js` | Separate production/rehearsal sources, exact token/asset URL validation, reveal checks, frozen display metadata and bounded cached reads. |
| `src/plot-studio.js`, `src/plot-studio.css` | Manual plot lookup, visual traits, isolated click-to-play animation and choosing a plot’s companion theme. |
| `src/reveal.js`, `src/asset-collector.js` | Fresh pinned-block reveal evidence and a resumable production metadata queue, separate from wallet economics. |
| `tools/collect-assets.mjs`, `src/collection-status.js` | Private VPS collector runtime and the browser’s validated public status read. |
| `src/model.js` | Cached rules, exact token-unit conversion, validation, public defaults and fictional CLI fixtures. |
| `src/engine.js` | Reward settlement, daily timelines, isolated wallet ledgers and advanced investment-policy comparisons. |
| `src/active-plan.js` | Validated persistent settings, isolated watched scope, fresh reserve inputs, remaining investment cap and guarded next-step guidance. |
| `src/active-plan-controller.js`, `src/plan-worker-client.js` | Opt-in monitor lifecycle, stale result cancellation, locks and worker isolation; no wallet provider. |
| `src/active-plan-view.js`, `src/active-plan.css` | Pure public active-plan presentation using shared theme tokens. |
| `src/reader.js` | Read-only RPC allowlist; ownership, balances, tiers, weights, costs and reserve observations pinned to one block. Metadata reads have separate evidence. |
| `src/approval-panel.js` | Optional action review, provider connection, independent action storage and receipt recovery. |
| `src/execution.js` | Restricted preparation, simulation, reviewed-runtime checks, exact allowances, individual submissions and persistent transaction locks. |
| `src/guidance.js`, `src/planner.js` | Shared strategy diagnostics, current-time guided plans and policy stress cases for the active plan and CLI. |
| `src/season.js`, `src/weather.js`, `src/allocation.js` | Public season reads, hypothetical event boundaries and allocation diagnostics. |
| `tools/build.mjs`, `tools/zip.mjs` | Produce website/userscript files in `dist/` and a separate native extension in `dist-extension/`, with a deterministic ZIP; never embed `portfolio/workspace.json` or owner addresses. |
| `tools/serve.mjs` | Loopback static development server with explicit file and origin restrictions. |
| `tools/analyze.mjs`, `tools/season.mjs` | Read-only CLI analysis, opt-in polling and season export. |

The public calculator runs locally after yielding a browser frame; it needs no worker or network. The active policy comparison uses the bundled `plan-worker.js` in website and native builds, and a disposable bundled Blob worker in Tampermonkey. Legacy `src/ui.js` and `src/guided-view.js` remain retired entry points. `dist/` can be served by a static HTTPS host; the generated `_headers` file provides security headers for hosts that support that convention. It is not an extension manifest and must not be loaded as an unpacked extension.

The native package has its own Manifest V3 manifest, scripts, external frame HTML/CSS, icon, licenses and installation notes. It excludes `_headers`, website files and the userscript. `dist/farm-companion-chrome.zip` and the versioned archive under `artifacts/` contain identical bytes, with sorted entries and fixed ZIP timestamps. Extracting the ZIP produces the directory Chrome expects for **Load unpacked**.

The separately named `artifacts/farm-companion-website-2.9.0.zip` contains the static `dist/` files, including hosting headers and the native-extension download. It is for website hosting, not **Load unpacked**.

## Visual interface

All three interfaces share a pixel field journal design with local Press Start 2P headings and IBM Plex body text. The default palette is forest and gold; selecting another theme changes page backgrounds, panels, navigation, controls, accents and artwork across all three tabs and the shared action panel. The build embeds built-in artwork and font files as data URLs so the installed plugins work without a companion asset host. Official image URLs, hashes and dimensions live in `assets/site/sources.json`; bundled font licenses and art credits ship in both distribution directories.

Showcase images represent levels or rarity examples, never exact NFT identity or ownership. Plot cards label these images, distinguish hypothetical models and preserve unknown traits. Enabling **Load plot artwork** substitutes separately labeled production or rehearsal images for each visible token; an unavailable image falls back to labeled example art. Cards show 23 plots followed by Show more in tile 24; each click adds up to 23 plots. List view uses the same page size. The visual upgrade trail (under **Levels & costs**) and funding meter reuse calculated values and never draft or submit a transaction. After intake, the gallery gets the main workspace; **Add plots**, **Wallets** and other utilities open separate panels. Layouts adapt to phones, keyboard focus remains visible, and decorative animation respects reduced motion.

The scenery picker offers the custom Field journal scene and five official cosmetic examples. Choosing a scene changes the entire companion palette and its illustration; it cannot alter scenario weather, yields, ownership or store availability. **Explore plot themes** opens a separate studio at the saved plot or token 331, with manual lookup and previous/next navigation across IDs 1–3333. **Use this plot’s theme** saves the validated artwork and derives a cosmetic palette from its visual traits. The theme stays independent of the optional inventory artwork toggle. Expansion image and inline-SVG provenance lives in `assets/site/expansion-sources.json`; both source manifests feed bundled `ART-CREDITS.txt` in all distributions. Search, wallet/state filters and sorting operate on inventory presentation only, never the portfolio passed to calculations. A pinned plot is a planning preference, not a transaction request or an override of the global upgrade ranking.

## Compact workspace

Version 2.6 uses a viewport-height shell with a persistent header and the three main tabs. The gallery and large result tables scroll inside their panels; tools do not extend a single long document. Desktop forecasts and upgrade ranking place controls beside results. Forecast subviews switch between Harvest, Weather lab, CROP goal and Planting. On phones, forecast settings collapse after calculation and can be reopened with **Edit forecast**.

Themes, Valley/calendar, Saved farms/downloads and Actions are utility panels. Main-tab clicks return to the selected task. Draft form values, disclosure state and panel scroll positions survive utility navigation; validated imports/resets clear the caches. Main tabs support arrow, Home and End keys. Secondary content uses native disclosures rather than inaccessible clipping.

The approval container is persistent outside the replaceable public view. Navigation hides/shows its panel without remounting its executor or rebuilding recovery inputs. Public render requests an approval refresh only when holdings or imported pending data changes; internal execution state still drives its own renders. Guided review selects Actions and focuses the review, while the header exposes pending-action status. Native extension origin storage and the narrow wallet bridge remain unchanged. Tampermonkey's explicit host height fits its launcher inset rather than extending to the outer window's full height.

## Production artwork and remote previews

`PLOT_ART_SOURCES` in `src/plot-art.js` centralizes separately validated production and rehearsal paths; production is the default. Imported farms cannot introduce arbitrary endpoints. Production reads first require a matching `/plot/{id}` response with `revealed: true`, then non-placeholder `/metadata/{id}` with real visual traits. HTTP success and token-shaped image URLs alone are insufficient. `normalizePlotArt` keeps bounded display text and approved same-token asset links, never portfolio or calculator fields. `validateSavedPlotArt` rechecks the environment, URL paths, ID, traits and observation timestamp, then recomputes visual traits and palette hints instead of trusting an imported hint.

The artwork reader uses the interface’s existing public transport, omits credentials and rejects redirects. Requests are coalesced, with at most three running at once and 24 pending; up to 100 results stay in memory for five minutes. Inventory artwork is a separate saved opt-in, loaded for the displayed page of cards, with manual retry after failures. The browser never crawls the collection. Failed production artwork retries when the shared collector reports new assets. The studio reads only the requested token. Cached artwork is not a current chain observation.

**Play animation** creates one remote iframe with `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`, without same-origin access, wallet privileges, top navigation or popups. The remote page’s code never runs in the companion origin. Pause, closing the studio or changing the viewed plot removes the frame and its polling. The observed remote script polls its environment’s live endpoint every 15 seconds. The companion does not ingest those counters.

In the September 12 samples, token 331’s metadata said level 1/dormant while its rehearsal live endpoint said level 2/planted. Both are testing display data; neither resolves ownership, economic rarity, levels, pending CROP or forecast assumptions. Endpoint evidence and the successful isolated Chromium preview are documented in `knowledge/rehearsal-assets.md`.

## Data and public defaults

A new workspace contains one empty wallet slot, no addresses and no assumed NFT ownership. The supported limit is 1–20 wallet records and 100 plots total. Holdings keep their version-1 schema for compatibility; the public workspace wrapper is version 2. Expected counts are intake metadata, not a requirement to model an entire collection. Supplied plots must still have unique IDs and valid, complete economic traits before analysis.

Watched wallets and hypothetical wallets are distinct in the interface. Public refresh updates addressed wallets at one block and preserves manual wallets. A failed read remains unknown; existing read errors, rule conflicts, unverified rarity or unsupported effective weight prevent a complete forecast. Failed inventory reads cannot silently become a zero-plot result. Revealed rarity requires finalized on-chain tiers, agreement with the committed manifest, and synchronized recorded/desired weight. Artwork or a default zero tier cannot establish Common rarity.

Inputs and imports are validated before use. Token quantities use BigInt base units internally and decimal strings in JSON. User-controlled text is escaped in the interface, and CSV exports neutralize spreadsheet formulas. Saved changes invalidate previous calculations. Wallet refresh is explicit unless the active plan monitor is enabled. Opening the forecast performs one automatic public read; **Use chain defaults** requests another and explicitly resets custom fields. The empty landing does not contact the chain. The CLI monitor remains separately opt-in.

The valley desk invokes `readSeason` only on **Check the valley** and stores the validated, dated snapshot separately from the scenario. Related chain reads use one block and report observation UTC, chain and partial errors; the current weather multiplier includes weather/events, while First Soil appears separately in the calendar. Neither a successful read nor a saved snapshot silently replaces forecast weather, harvest-limit or reserve inputs. Calendar status is computed from published dates and current time; only fresh chain evidence can establish completion or current contract state.

## Forecast initialization

`forecast-defaults.js` initializes every public forecast field from cached rules, then accepts a season observation only when both its block and retrieval timestamp are within five minutes and Genesis matches the cached rules. Reserves and their start timestamp are one group; missing one reserve falls back for both, and editing any of the three keeps the entire custom group. Post-Genesis outside weight subtracts watched holdings only; models are additional hypothetical plots. Outside weight is optional and defaults to zero when unspecified; no full-collection planting assumption is inserted before Genesis. The full-supply helper remains an explicit advanced scenario. Future growth and weather continuation remain scenarios.

`forecast-market.js` reads the configured pool, pair identity, decimals, fee, liquidity and Q64.96 price at the season block. An empty/uninitialized/locked or mismatched pool cannot supply a market reference. Fee-adjusted spot prices exclude trade size and gas. Unavailable prices use labeled seed-bag planting parity, never an executable quote. These new read-only contracts are not transaction targets. Detailed fallbacks and dated evidence are in `knowledge/forecast-defaults.md`.

The public workspace saves manual field names under `forecastManual`. Legacy nonempty scenario fields are treated as custom on import; new workspaces start with no overrides. In-progress edits, calculations, navigation, imports and action locks prevent delayed refreshes from overwriting reviewed inputs. Reopening the page can refresh automatic fields; it does not resume polling or wallet execution.

## Reward accounting

The current model follows the September 11 Almanac and reviewed economy-v2 contracts. Cached constants live in `knowledge/rules.json`; deployment evidence lives in `knowledge/reviewed-deployment.json` and `knowledge/contract-review.md`. Earlier rules and deployment records remain historical evidence.

For each fixed-weight segment:

1. Add the released annual schedule budget to opening carry, using the source's integer per-second rate.
2. Compute nominal rewards at 2,000 CROP per weight unit per week.
3. Limit the base reward to available schedule plus carry; retain the unused amount as carry.
4. Apply weather multiplied by First Soil. Weather/events cap at 2× before First Soil, so the combined factor can reach 4×.
5. Limit bonus rewards to the remaining Granary. Below-base shortfalls replenish Granary.
6. Allocate the farm payout proportionally to planted weight.

Zero planted weight leaves released budget in carry. It does not allocate an instant backlog to a later planter. Integration splits at Genesis, year, weather/event and First Soil boundaries, stops after four 365-day years, and advances carry and Granary once per interval. Future deposits and sweeps are not inserted without explicit inputs. Daily decisions and allocation floors still approximate the contract's exact transaction timing and accumulator rounding.

Opening carry and Granary are explicit scenario values. An observed basis requires both values and an observation timestamp. A post-Genesis start must match that timestamp within one minute; pre-Genesis observations can initialize Genesis. Moving to a different start requires a fresh observation or an explicitly hypothetical basis. Current readings are not silently turned into future weather or valley-weight forecasts.

## Forecasts and investment advice

`analyzeFarm` keeps ownership, activation and levels fixed. It reports 7/30/90/365-day gross rewards plus a custom 1–365-day term. Ending CROP includes opening liquid and pending balances exactly once. Optional ETH values are estimated gross reward value, before costs; they are not realized profit.

`analyzeInsights` projects the whole farm once for the chosen term and goal horizon, then allocates that settled payout to wallets and plots by their active weight. Reserves are not replayed once per plot. Plot cards display the first projected day's income and the term total; the first day begins at the selected forecast start. Integer daily allocations can leave a few base units below the portfolio total. Dormant plots receive no new harvest.

CROP goals describe a desired total wallet balance, counting opening liquid and pending once and then passive earnings. Wallets remain separate; goal dates scan whole days up to 365 from the selected start. The result distinguishes funds already liquid, claim-first funding, accrue-then-claim funding and targets beyond the horizon. Claims, spending, transfers and ETH fees are not silently inserted into this savings projection.

The five weather rows are independent whole-term alternatives. Each replaces weekly weather and any dated weekly-weather path while keeping events, harvest-limit assumptions and opening carry/Granary unchanged. Every row reruns settlement through the same finite-reserve engine; differences compare against the selected forecast. Clicking a sky explicitly changes the scenario and recalculates. These comparisons do not predict future oracle outcomes.

Each upgrade row is an independent alternative. It measures the change in the whole portfolio's earnings after one next-level upgrade, including resulting changes to the global ceiling, carry and Granary. Ranking compares marginal CROP return per token spent; rarity alone is insufficient. Dormant plots require planting before an upgrade can produce income.

Affordability uses only the candidate wallet's liquid CROP, existing pending rewards and future earnings from its current active plots. Pending CROP requires a claim. Immediate-upgrade net returns are separate from returns after waiting for that wallet to fund the upgrade. The next fundable recommendation must remain profitable within the selected term after this delay. Timers use whole days through 365 days and check CROP funding, not ETH fee affordability.

Advanced `compare`/`simulate` retain harvest-funded and extra-investment models, CROP and ETH objectives, 30/90/365-day comparisons, complete affordable paths and hold/no-upgrade alternatives. The optimizer tests efficiency/net-gain policies and several extra-budget fractions; it does not prove a global optimum. Purchases are capital, fees debit the paying wallet, claims make pending rewards liquid, and CROP/ETH conservation is checked. Transfers require explicit scenario settings; NFT consolidation is a separate two-wallet comparison with activation reset and replanting. The advanced investment ledger currently models CROP-funded planting; the public calculator separately compares the native seed-bag quote.

## Persistence and action boundaries

The dashboard stores its workspace under `yield-farm-public-v2` and actions under `yield-farm-public-approvals-v2`. The userscript uses separate GM keys `public-workspace-v2` and `public-approvals-v2`. The native extension stores its farm and action journal in synchronous local storage on its own extension origin, inside the embedded frame; it does not treat asynchronous `chrome.storage` calls as completed durable action writes. Interfaces and browser origins do not synchronize automatically. Farm JSON and the separately exported action journal serve different purposes. Public builds never read a local private portfolio into their payload.

Version-2 workspaces now include validated `companion` preferences (scene, optional `theme_plot` artwork, independent `artwork_enabled` opt-in, total CROP goal, wallet and pinned plot) plus an optional validated `season` observation. Older exports receive default companion preferences. These values follow farm save/import/export within each interface; filters, sorting and the selected view are transient. Changing scenery or choosing a plot theme preserves the current analysis; changing a goal refreshes its derived insights. Action journals remain separate.

Watching or calculating never accesses the injected wallet provider. Connection is explicit. Supported actions are CROP planting, native ETH seed-bag planting, one-level upgrades and claims within one wallet. Every CROP allowance and every subsequent spend require their own submission and MetaMask confirmation. Preparation checks a fresh pinned block, configured account/chain, ownership, reviewed runtime and linked contracts, costs, pauses, balances and allowances, then simulates and estimates gas. Drafts expire after 90 seconds; changed state or a changed seed-bag price requires new review.

A pending record is persisted before submission. Ambiguous broadcasts remain locked across reloads. Matching transaction identity, value, nonce and canonical receipt are required for reconciliation. Replacements must consume the same wallet nonce; cancellation is recorded as replaced, never as successful game execution. Another tab cannot silently overwrite a changed action record, but users must still use one interface/tab for execution.

Compatible imported pending records can be adopted into empty action storage. Conflicting locks block actions and must be reconciled separately. Old deployment targets are not treated as current actions: their records must be preserved and reconciled using their original evidence/interface. Resetting a calculator is not a way to erase an unresolved transaction.

See [USAGE.md](USAGE.md) for the public workflow and [TESTING.md](TESTING.md) for verification commands and limits.

## Active-plan lifecycle

Public workspaces persist validated `activePlan` settings and per-wallet `activePlanClock` advisory UTC anchors. Results and drafts are not persisted as authority. The controller reads every watched wallet at a single fresh block, excludes hypothetical wallets, rebases only the plan scenario and dispatches the shared policy engine in a cancellable worker. A worker request has a two-minute timeout; generations and input fingerprints discard stale responses. Financial changes invalidate the plan; cosmetic changes do not. Imports pause monitoring. The remaining extra-investment budget is total cap less the visitor's manually recorded used amount.

A saved enabled plan can resume public reads on reload. Automatic work skips hidden pages/panels, dirty forms, modal editing and approval locks. Native iframe visibility is observed with IntersectionObserver. The userscript supplies its panel visibility predicate. Browser timer callbacks are wrapped to retain their global receiver.

Guided review refreshes again, compares the shown action identity with the fresh result, and passes only an allowlisted intent to `mountApproval.prepareIntent`. That bridge uses the existing executor and journal, validates plan context before/after preparation and again before submit, and never connects or submits itself. Its synchronous action-state snapshot pauses monitoring while a draft, busy operation, corrupt journal or pending transaction exists. Receipt reconciliation refreshes and rebuilds, including after an allowance, while preserving separate human submission for the spend.

Active claim clocks survive wallet refreshes and reloads. New watched wallets receive an advisory first-build anchor; successfully reconciled claims advance it to reconciliation time. External claims are not inferred. The engine updates its simulated clock after any claim, including funding prerequisites, and avoids forced early terminal claims in clock mode. Equal-return candidates prefer lower fees and then fewer actions. Ordinary CLI scenarios without a claim clock retain their original cadence.

The planner still compares a bounded set of policies and budget fractions. It does not promise a global optimum, execute swaps/transfers, model native seed-bag planting in its policy search, infer NFT premiums or treat purchased CROP as profit. Production and rehearsal artwork never enter this economic pipeline.

## Dated weather and repeated upgrade routes (2.7)

`src/weather-schedule.js` reads reviewed WeatherOracle code, full scheduling logs from its deployment block, Genesis, commitment and epoch getters at the caller's pinned block. Latest per-epoch writes win; missing or disagreeing evidence yields an unavailable observation. Unset epochs become verified inherited history only strictly after their cutoff, following the reviewed 52-week lookup. Reader snapshots and standalone season reads carry this optional observation.

Public defaults enable `useKnownWeather` with `knowledge/launch-weather.json` as an explicitly dated cache; fresh matching-block schedules replace the whole list. `weatherBps` describes unrevealed weeks (Fair default). Absolute `weatherWeeks` split engine timelines at Genesis-anchored boundaries, independently of First Soil. Legacy explicit weather imports and weather-lab/stress counterfactuals opt out. Active watched plans use matching fresh weather evidence when rebasing.

`analyzeFarm` retains legacy `upgrades` and adds `upgrade_paths`, ordered cumulative steps, best immediate and best funded term-return paths, and post-claim purchase shortfall/principal estimates. Routes are independent same-plot alternatives; the existing bounded policy planner handles sequential investment, revisits and fees. Route CSV exports the selected comparison. Grid pagination uses 23 cards followed by its 24th-item load-more tile.

## Persistent reveal collection

`dist-collector/collector.mjs` is a separate Node bundle, excluded from public website and extension packages. Its isolated VPS container checks chain 4663 every 30 seconds while waiting. The gate verifies the NFT runtime, manifest commitment, fresh block and positive reveal offset; a sellout or published date does not prove reveal. Each asset must then pass the production live-state and metadata validators. Finalized economic tiers remain an independent requirement for wallet advice.

Due assets drain with at least 500 ms between API requests, bounded responses/timeouts and retry backoff. The collector preserves private raw observations and atomic checkpoints under `/opt/farm-companion/collector/data`. Only normalized `/collection/status.json` and `/collection/plots.json` are served by Nginx. Images and remote HTML are not downloaded by the collector. A changed collection identity invalidates its active catalogue while preserving archived evidence. Completion slows chain checks rather than repeatedly downloading the collection.

The Valley reveal panel reads status while visible, and the optional production inventory artwork view can use progress to retry pending artwork. This does not enable wallet monitoring or alter holdings, rarity, forecast assumptions or action journals. The userscript’s additional companion-host permission permits only the exact public status GET. Collector runtime updates use a separately guarded activation and durable recovery record; unchanged runtime hashes do not restart a healthy watcher.

## Nominal rate and funding limits

Version 2.9 exposes a shared own-weight rate at the forecast start and segment-derived diagnostics for the selected term. The rate is 2,000 CROP/week × active weight × weather × First Soil. Annual schedule/carry and finite Granary settlement remain unchanged and still feed all upgrade, wallet goal, weather, active-plan and CLI calculations. A funded term projection is distinct from a momentary nominal rate. Binding-limit flags come from actual segment constraints, not rounding differences in proportional allocation.

The public form places additional valley weight, weight growth and full-supply/observed presets inside Harvest limits. Missing outside weight is a zero-additional-weight scenario; it is not a verified participation forecast. Explicit imports remain scenarios and valid observed post-Genesis context still supports constrained projections. The active plan’s first stress case now starts with an empty Granary and reruns the selected policy.

The collector status adapter may expose a bounded mint count only from a verified chain observation. Minting and canonical animation URLs do not bypass positive-offset, revealed-state or real-metadata gates. The September 15 review and archived evidence are in `knowledge/harvest-rate-2026-09-15.md`.

## September 26 compatibility

Execution deployments now derive from reviewed-deployment.json, including the immutable V2 dependency of NativeActivationV3. Legacy V1 targets are accepted only for receipt recovery, never new submissions. Public reads collect per-plot bag/sprouts eligibility as optional planning metadata; missing eligibility cannot authorize a planting. Oracle event-history failures fall back to reviewed slot-2 storage at the original pinned block and cross-check weather getters; inherited future getters never become announcements.
