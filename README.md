# Farm Companion

A fan-made field journal for Yield Farm: track your plots, forecast the harvest and plan your next upgrade. Version 2.10.0 fills estimates automatically: connect a wallet, see its harvest, and compare upgrade paths. Custom settings live behind an optional control, with the same experience on the website and browser plugins. Anyone can model **1–20 wallets and up to 100 plots**, with no account required.

Open [farm.pagzi.tech](https://farm.pagzi.tech/) for the hosted companion. Validated workspace changes publish automatically to the Hostinger VPS; see [deployment operations](deployment/README.md).

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4173**. Add public wallet addresses or build a hypothetical farm. Public tracking does not connect MetaMask. Each browser starts empty and stores its own data locally.

- **My farm:** illustrated cards with plot-level harvest estimates, wallet/status/search filters, sorting, public wallet reads and model farms.
- **Plot studio:** explore any plot from 1–3,333, inspect its revealed production traits or switch to rehearsal, play its animation and use its artwork and palette throughout the companion.
- **Around the valley:** a manual public read of weather, mint progress, planted weight, Granary and seed-bag price, plus the collection reveal watch, published milestones and a calendar download.
- **Yield forecast:** known launch weeks plus explicit unrevealed-weather assumptions, dated First Soil, 7/30/90/365-day views, harvest charts, weather comparisons, CROP goals and CSV exports.
- **Upgrade planner:** compare cumulative routes through level 5 or next-level returns, follow wallet funding delays, and price a purchase shortfall.
- **Active plan:** opt-in wallet monitoring, whole-policy comparisons, separate wallet budgets, stress cases, a due next step and individual transaction reviews. Rebuilds after reconciled receipts.
- **Planting comparison:** CROP payment versus the current ETH seed-bag quote, with fee assumptions kept explicit.
- **Optional actions:** separately reviewed MetaMask approvals, CROP/ETH planting, one-level upgrades and claims. Every transaction needs its own explicit submission and wallet confirmation.

Calculations follow the [Almanac](https://rh.farm/almanac/#weight), rechecked September 15: nominal weekly CROP is 2,000 × your active weight × First Soil × weather. Annual base ceilings, unused carry and finite Granary funding still apply. Published promises and verified-contract differences are recorded separately. Forecasts depend on weather, harvest-limit, reserve and price assumptions; estimated token value is not realized profit.

## Install the Chrome / Edge extension

Extract **farm-companion-chrome-2.10.0.zip**, open **chrome://extensions** (or **edge://extensions**), enable **Developer mode**, and **Load unpacked** from the extracted folder containing **manifest.json**. Reload **https://rh.farm/** to open the companion. The native extension needs no Tampermonkey or local server.

For source builds, `npm run build` generates the directly loadable **dist-extension/** directory and **dist/farm-companion-chrome.zip**. Use either the native extension or the userscript, with the other disabled. Website, userscript and extension saves are separate; farm JSON and action-journal exports move them between interfaces.

## Deploy to Vercel

Import [PagziTechInc/farm-companion](https://github.com/PagziTechInc/farm-companion) into Vercel, keep the root directory at the repository root, select Node.js **24.x**, and deploy **main**. The included `vercel.json` sets **Other** as the framework, installs dependencies, runs `npm run build`, and serves only `dist/`. No environment variables or API keys are required. Connect the GitHub repository to deploy subsequent pushes automatically.

Website, planner worker, userscript and extension download are included. The existing VPS continues running the collection watcher; Vercel reads its public outputs from `farm.pagzi.tech`. Keep that hostname pointing to the VPS while using your Vercel URL or a different custom domain. Moving `farm.pagzi.tech` itself requires a separate collector hostname and an endpoint update first.

Browser saves belong to each origin. Export your farm and action journal from the old site before moving to a new domain; import them there, and reconcile pending actions before submitting more transactions.

See [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json) for the hosting settings. The existing VPS deployment remains available.

## Share the public platform

```sh
npm run check
```

Upload **only `dist/`** to any static HTTPS host. It includes the website, downloadable native-extension ZIP, installable `yield-farm-companion.user.js`, metadata and optional host security headers. The calculator needs no backend; the hosted reveal watcher runs separately on the companion VPS. Builds never embed the owner's local portfolio, and can reject locally configured private wallet identifiers in browser bundles. Do not publish the workspace or `portfolio/` directory as site content.

**farm-companion-website-2.10.0.zip** is the website package for static hosting. **farm-companion-chrome-2.10.0.zip** is the native extension package for **Load unpacked**.

The **public website ZIP / dist directory is not an unpacked Chrome extension**. Its `_headers` file is for website hosts. For **Load unpacked**, use the separate Chrome extension ZIP or `dist-extension/`; for Tampermonkey, install the `.user.js` file through Tampermonkey.

This release is ready for static hosting; building it does not publish a live website. The userscript runs on `https://rh.farm/` and needs no local server after installation.

Built-in artwork and fonts are bundled locally in all three interfaces. Choose Field journal, Original field, Deep Winter, Festival Night, Autumn Gold or Storm Watch to change the illustration and the full companion palette. **Explore plot themes** opens the production plot studio; **Load plot artwork** separately enables per-token images on your inventory cards. Artwork and visual traits stay separate from ownership and calculated yields. Animation starts only when you press play and stops when paused or closed. Themes, goals and plot targets stay in the current interface’s saved farm and travel with its JSON export. Official showcase art remains labeled as example art. [Artwork sources](assets/site/sources.json) · [Season art and weather icons](assets/site/expansion-sources.json) · [Custom field-station scene](assets/generated/companion-field-station.webp) · [Scene references and prompt](assets/generated/README.md).

Production uses `/plot/{id}` for its reveal flag, `/metadata/{id}` for traits and `/animation/{id}.html` for previews. **Valley → Reveal watch** shows server collection progress and a JSON catalogue download. The watcher checks for a verified chain reveal, then gathers all 3,333 valid metadata records with pacing, retries and restart checkpoints. Sealed responses remain pending. [Production findings](knowledge/production-assets.md) · [Rehearsal findings](knowledge/rehearsal-assets.md).

[Usage and installation](docs/USAGE.md) · [Architecture](docs/ARCHITECTURE.md) · [Validation](docs/TESTING.md) · [Rulebook](knowledge/rulebook.md) · [Contract review](knowledge/contract-review.md)

Advanced strategy comparisons and read-only monitoring remain available through the CLI:

```sh
npm run analyze -- --workspace exported-workspace.json --output artifacts/report.json
npm run analyze -- --demo --output artifacts/demo-comparison.json
npm run season -- --output artifacts/current-season.json
```
