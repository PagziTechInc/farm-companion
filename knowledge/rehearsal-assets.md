# Rehearsal plot artwork — September 12, 2026

The user supplied the rehearsal endpoints for visual testing and will provide the production API later. These responses are **testing artwork and display traits**, not ownership, reveal, rarity, activation, level, pending rewards or yield evidence. The Almanac remains the gameplay source of truth. No gameplay constants or reviewed transaction contracts changed during this inspection.

## Primary endpoints and observations

Four metadata IDs were sampled, not the entire 3,333-token collection. Responses and headers were recorded at approximately **18:15:46 UTC, September 12, 2026** in a local research archive (excluded from the public repository).

- Metadata: [`https://api.rh.farm/rehearsal/331`](https://api.rh.farm/rehearsal/331)
- Image returned by metadata: [`https://api.rh.farm/rehearsal/image/331.png?r=1337`](https://api.rh.farm/rehearsal/image/331.png?r=1337)
- Remote animation: [`https://api.rh.farm/rehearsal/animation/331.html`](https://api.rh.farm/rehearsal/animation/331.html)
- Animation's separate testing data: [`https://api.rh.farm/rehearsal/live/331`](https://api.rh.farm/rehearsal/live/331)

Replace `331` with a canonical integer from 1 through 3333. The current source is centralized in `src/plot-art.js` as `PLOT_ART_SOURCE`. A production migration must explicitly update the source and URL allowlists; arbitrary imported endpoint URLs are not configuration.

Metadata uses `name`, `description`, `image`, `animation_url`, `external_url` and an `attributes` array. The six visual trait names observed are **Soil, Crop, Scarecrow, Sky, Fence, Critter**. Additional display attributes are Level, Rarity Tier and Planted. The external URL points to `/plot/{id}` and is not used as a trusted artwork or economic source.

| Token | Soil | Crop | Scarecrow | Sky | Fence | Critter | Display rarity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [1](https://api.rh.farm/rehearsal/1) | Loam | Mushroom | Bear | Day | White Picket | Chicken | Common |
| [331](https://api.rh.farm/rehearsal/331) | Golden | Golden | Golden | Golden | Golden | Golden | Golden Acre |
| [999](https://api.rh.farm/rehearsal/999) | Loam | Corn | Astronaut | Day | Stone | Bees | Common |
| [3333](https://api.rh.farm/rehearsal/3333) | Clay | Moon Beans | Classic | Day | Gold | Cow | Fertile |

These samples do not establish trait distributions, complete vocabulary, final token identity, rarity or ownership. Token 331's metadata reported level 1 and dormant, while its rehearsal live endpoint shortly afterward reported level 2 and planted with a sample CROP counter. That divergence reinforces the display-only boundary; it must not be silently reconciled into holdings or forecasts.

## Animation and browser behavior

The remote HTML embeds its own image and script. In rehearsal mode it fetches `/rehearsal/live/{id}?fresh=…` every 15 seconds and updates its display every second. It visually extrapolates a counter from the returned testing rate, marks data stale after 60 seconds and may display weather, level, planted status and recent harvest information. Those numbers are not the companion's verified reads or calculations.

Observed metadata and HTML responses were HTTP 200 with `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. No `Content-Security-Policy`, `frame-ancestors` or `X-Frame-Options` header was present on the sampled HTML response. Initial Python/web-tool requests returned 403 or safe-open errors; curl and Chromium subsequently succeeded without authentication. This is an observation, not a guarantee of future availability.

Chromium successfully displayed the remote animation with **`sandbox="allow-scripts"`** and **`referrerpolicy="no-referrer"`**, without `allow-same-origin`, wallet permissions, top navigation or popups. Token 331's image loaded and the rehearsal registry rendered. See [`browser-framing.json`](snapshots/rehearsal-browser-2026-09-12/browser-framing.json) and [`sandbox-preview.png`](snapshots/rehearsal-browser-2026-09-12/sandbox-preview.png). The remote frame loaded Google Fonts and a Cloudflare beacon, and its Cloudflare RUM request failed. Remote code belongs exclusively inside this isolated, explicitly opened frame; never copy its scripts into the companion document. Closing the preview should remove the frame to end its polling.

## Companion data boundaries

`normalizePlotArt` emits frozen display-only strings, six visual traits, canonical metadata and animation links, an approved image revision URL, a cosmetic palette hint and observation UTC. It does not copy economic-looking top-level fields. Renderer text still requires ordinary HTML escaping. Metadata URLs are built from an integer ID; returned asset URLs must match the exact HTTPS origin, source path and token ID. Credentials, fragments, foreign ports/origins, path aliases, script/data URLs and arbitrary query strings are rejected. Only the observed image revision form `?r=<integer>` is accepted.

`createPlotArtReader` uses the caller's existing transport with omitted credentials and redirect rejection. It coalesces repeated requests, limits concurrent fetches to three, limits pending work to 24 and keeps at most 100 normalized entries for five minutes. Refresh is explicit. Cached art is an in-memory convenience, never a live claim. A chosen theme's saved art is independently revalidated on import; its palette hint and visual traits are recomputed from bounded display traits. Production metadata cannot be imported as rehearsal art.

Palette hints are a companion interpretation of visual words, not a published game rule or token rarity mapping. Golden sky or a Golden soil/crop pairing suggests gold; winter, storm, night and autumn words suggest corresponding visual palettes; unknown visual words retain a neutral field palette. A rarity label by itself never selects a theme or establishes a calculator tier. The animation remains labeled **Rehearsal preview**, and choosing its look cannot alter wallet or forecast inputs.

## Verification

`tests/plot-art.test.js` covers exact IDs/URLs, rejected URL attacks, display/economic isolation, immutable normalized data, saved-source validation, palette inference, coalescing, TTL, least-recently-read eviction, bounded concurrency/queue, retries and cache clearing during a pending read. Thirteen tests passed during module development. Integration tests remain responsible for the visible label, image fallback, close behavior, all three browser adapters and persistence of the selected appearance.

September14 update: production URLs were supplied and verified. Rehearsal remains a separately selected cosmetic source; see [production assets](production-assets.md). Earlier waiting-for-URL statements above are historical.
