# Validation and tests

Run the complete offline release check with Node.js 22+, Python 3 and Chromium:

```sh
npm ci
npx playwright install chromium
npm run check
```

This runs Node unit/integration tests, builds the website, Tampermonkey and native Chromium extension bundles, validates the local knowledge store, then tests all browser entry points. Version 2.3.0 passed **160 Node tests, 42 browser tests and 195 knowledge checks**. The full release log is `artifacts/check-2.3.0.log`; current visual evidence is under `artifacts/companion-2.3/`. Public provider tests use local fixtures; no real wallet or transaction is needed. The Python validator checks rules, source references, deployment evidence and independent reward arithmetic without network access.

The suite covers the nominal rate, exact First Soil/year/event boundaries, finite Granary depletion/replenishment, unused carry, per-wallet funding, pending balances counted once, delayed-upgrade profitability, unsupported states and capital conservation. Reader tests cover pinned blocks, arbitrary wallet counts, partial failures, finalized rarity, manifest consistency and weight conflicts. The executor tests cover exact allowances, native seed-bag values and repricing, reviewed runtime/linkage checks, stale/changed state, rejected requests, durable locks, duplicate submission and receipt/replacement identity.

Browser tests cover an empty public landing with no initial network or provider access, model wallets and plot edits, arbitrary forecast terms, upgrade timers, JSON/CSV exports, failed public reads, observed-reserve provenance and mobile layout. The generated userscript is tested with simulated GM APIs on the game origin. The current optional action panel is exercised through preparation, explicit approval and pending-lock recovery across reload. Retired private v1 UI scenarios are preserved in `tests/history/v1`; they are not part of the public browser suite.

The visual release also verifies local image decoding, plot cards/list switching and pagination, preserved holdings, and forecast term shortcuts. Website and plugin screenshots cover desktop and phone layouts; layout checks inspect horizontal overflow and open/close behavior. No external images or fonts are requested during the empty landing test.

The native extension test loads `dist-extension/` in a real persistent Chromium profile with Manifest V3, rather than injecting the bundle as a script. It checks image decoding, forecasts, extension-only local storage, persistence across reloads, no automatic wallet requests, explicit account connection through the background scripting adapter, rejected-request error codes and keyboard close. Provider calls use a page fixture. Ten additional Node tests enforce trusted iframe senders, the game origin, supported wallet methods, Robinhood Chain and reviewed transaction destinations. ZIP extraction and CRC verification confirm a root manifest and no reserved underscore filenames.

Version 2.2 adds 12 calculation tests for per-wallet CROP goals, pending rewards counted once, per-plot allocation, changing competition, weather comparisons, finite Granary and unsupported holdings. Four calendar tests check exact First Soil boundaries, published milestone dates and valid folded UTC ICS exports. Seven browser tests exercise weather recalculation, goal selection and persistence, inventory filtering and upgrade targets, calendar contents, scenery without economic changes, failed valley reads and successful pinned-block reads that preserve wallet holdings and forecast assumptions. The 100-plot, 20-wallet, 365-day insight calculation completed in approximately 10 ms on the development machine.

Version 2.3 artwork tests cover strict token IDs and asset paths, hostile URLs, frozen display-only metadata, saved-art validation, bounded concurrency and cache behavior. Theme coverage checks full-interface palette selection and trait interpretation without changing economic inputs. Browser coverage exercises manual rehearsal lookup, per-token card art, theme persistence, failed reads and image fallback, sandboxed click-to-play animation, pause/close cleanup and the separate artwork opt-in across the website and browser plugins. The live rehearsal evidence is under `artifacts/rehearsal-assets/`; these testing counters are never portfolio fixtures.

Version 2.5 passed **206 application tests, 56 browser tests, 16 deployment tests and 198 knowledge checks**. The local check log is `.local-deploy/check-2.5.0.log`. Random-model tests cover published rarity boundaries and without-replacement sampling. Forecast tests cover pre/post-Genesis defaults, fresh block identity, partial reserve reads, ordinary weather, observed versus hypothetical competition, empty/mismatched pools, fee-adjusted pricing and custom fields. Browser cases cover random intake, complete offline forecasts, pinned chain reads, delayed responses during editing, explicit reset, valid partial fallbacks, exact-second reserve starts and reset/resubmit races. Public chain calls are fixture-controlled in regression tests; separately dated real reads are retained under `knowledge/snapshots/`.

Version 2.6 adds a compact workspace shared by all three browser entry points. Browser regressions check viewport height, internal plot scrolling, separate forecast views, utility navigation, preserved unsaved forecast/plan inputs, and pending-action recovery. Invalid submissions keep the entered value for correction while saved holdings and valid results stay intact. The desktop/phone tour covers 14 views without document overflow or page errors; private screenshots and measurements are in `.local-deploy/compact-2.6/`. Live deployment smoke also checks desktop and phone workspace height.


Useful individual commands:

Production deployment runs these checks in an isolated source snapshot on port 4197 (`FARM_DEPLOY_CHECK=1` prevents reusing another build's server). `npm run test:deployment` checks the public-file boundary, release hashes, guarded rollback and preservation of older assets. After activation, a fresh Chromium session on HTTPS checks empty intake, image decoding, forecasts, a model active plan using its release-scoped worker, mobile layout and absence of wallet/provider requests. A failing live check restores the previous release. Logs, release status and screenshots remain in `.local-deploy/`. See [deployment operations](../deployment/README.md).

```sh
npm test
python tools/validate_knowledge.py
npm run build
npm run test:browser
npm run analyze -- --demo --output artifacts/demo-public-v2.json
npm run season -- --output artifacts/current-season.json
```

The last two commands respectively exercise the retained CLI and perform an explicit live public read. A September 11 season smoke read at block **60,600,743** returned no read errors, zero minted supply/weight, zero carry, 40M CROP Granary and a 0.001 ETH seed-bag price. It is a historical observation, not a future quote. Reviewed deployment evidence is archived separately in `knowledge/snapshots/verified-contracts-2026-09-11/`.

Current theme and rehearsal studio screenshots are available in `artifacts/companion-2.3/`; earlier forecast, planner and plugin screenshots remain in `artifacts/companion-2.2/` and `artifacts/redesign/`. Playwright failure diagnostics go to `test-results/`. Screenshots use empty or fictional model farms; rehearsal scenes are labeled testing artwork. The local test server uses port 4173 and can reuse a running server; rebuild first after source changes.

No real transactions were sent. These checks do not establish future profitability, reproduce every contract accumulator rounding event, prove future weather or airdrop promises, or test installation in every real browser/MetaMask/Tampermonkey profile. Actual post-mint holdings and receipts remain live inputs. Only `dist/` is intended for public hosting; build checks reject the original owner's configured addresses in either public bundle.

Version 2.7 adds dated schedule tests for pinned event history and reviewed code, latest scheduling writes, missing-history detection, exact cutoff equality, 52-week fallback limits, week-boundary and rebased First Soil arithmetic, base ceilings and empty Granary. Route tests cover cumulative burns, distinct wallets, waiting, repeat levels and explicit quote principal. Browser regressions cover 23-card pagination, all 100 plots, known-versus-unrevealed weeks, legacy custom weather and route navigation.

Version 2.8 adds separate production/rehearsal readers, live reveal flags, placeholder rejection, safe canonical animation fallback, metadata trait requirements and saved-theme source identity. Collector tests exercise chain-gated collection, paced requests, bounded responses, retry backoff, partial progress, restart checkpoints and changed collection identity. Deployment tests cover collector runtime hashes, container-readable file modes, activation health, durable rollback and public-file boundaries. Browser checks cover source selection, waiting-for-reveal presentation and collection progress without changing farm economics.

Production evidence is archived under `knowledge/snapshots/production-assets-2026-09-14/`. A bounded local collector run verified the configured chain, NFT runtime and manifest at block 62,490,872 on September 14, 2026 UTC; supply and reveal offset were zero. Actual revealed production metadata has not yet been observed. Future reveal behavior is exercised with fixtures, and the live watcher waits for all validation gates rather than treating placeholders as assets.

Version 2.9 verifies the own-weight nominal formula separately from funded projections: outside-weight invariance below limits, binding base ceilings and Granary depletion, exact First Soil/weather/year boundaries, optional outside-weight inputs, preserved explicit scenarios, and rate/limit presentation across public interfaces. Mint-progress tests confirm that sellout and animation links cannot promote unrevealed plots to real traits. The September 15 live runtime and API evidence is archived under `knowledge/snapshots/rate-review-2026-09-15/`.
