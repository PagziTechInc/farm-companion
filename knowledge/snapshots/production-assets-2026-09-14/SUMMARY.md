# Production collection API evidence

Observed September 14, 2026, 03:08–03:12 UTC. Exactly three token IDs sampled: 1, 346 and 3333. Raw bodies, response headers, UTC retrieval times, URLs and SHA256 hashes are listed in fetches.json. No wallet, signing, transaction or collection crawl occurred. No repository source, test, knowledge or documentation file was edited.

## Observed endpoints and prereveal schema

- Live display record: https://api.rh.farm/plot/1?fresh=1789355042929 (same route for IDs 346 and 3333).
- NFT metadata: https://api.rh.farm/metadata/1 (same route for IDs 346 and 3333).
- Animation: https://api.rh.farm/animation/346.html (same route for IDs 1 and 3333).

All nine responses were HTTP 200 without authentication or redirects. All three live records have the same prereveal shape, differing in tokenId:

```json
{"tokenId":1,"revealed":false,"level":1,"tier":null,"tiersFinalized":false,"planted":false,"pendingCrop":"0","at":1789355296,"equipped":[0,0,0,0],"wardrobe":{},"weightBps":null,"lastHarvestAt":null,"lastHarvestCrop":null}
```

These fields are API display data, not a pinned chain observation, ownership evidence, balance authority, or transaction permission. In particular level 1 and planted false are defaults on an unrevealed response. The post-reveal types of currently null fields were NOT observed.

All sampled NFT metadata has name (zero-padded Plot number), description, image, external_url and attributes. Its only attribute is {"trait_type":"Status","value":"Unrevealed"}; image is https://api.rh.farm/image/unrevealed.png. The external_url points to the JSON API /plot/{id}, not an HTML plot page. animation_url is absent. There are no six visual traits before reveal. The descriptive claim that a deadline is contract-enforced must not override the existing contract review.

Actual post-reveal production metadata is not available in the sampled responses; its complete field list and query forms therefore remain unknown. Do not silently copy rehearsal-specific fields or revision rules into the production validator.

## Canonical visual URLs and placeholder trap

The user-supplied canonical animation is /animation/{id}.html with no query. This URL already returns a wrapped scene and can be safely constructed when metadata omits animation_url.

The production animation's own read() code constructs the revealed image as:

`https://api.rh.farm/image/{id}.png?s={level}{p|d}b`

Here p/d follows the display record's planted flag. For example: /image/346.png?s=1db. Only this s revision pattern was observed in production; no production ?r=<digits> or animation query was observed. If supporting this image query, restrict level to 1–5 and the full suffix to [pd]b, along with exact HTTPS origin and matching token ID. Do not accept arbitrary returned query parameters.

A crucial check: /image/346.png?s=1db currently returns the SAME PNG BYTES as /image/unrevealed.png. Both are 307,577 bytes, SHA256 15fdaeaa805835cf239d90a10114ccd89db163e99e4ae22a48360a543fae6cd7, with the same strong ETag. A token-shaped image path, status 200, or loaded image alone cannot prove revealed art. Keep chain reveal gating and explicit API/metadata prereveal checks; where collection image bytes are already being fetched, comparing to the observed placeholder avoids storing it as a completed revealed asset. Do not download all images merely to test this.

## Cache and browser transport

JSON metadata and /plot responses advertise Cache-Control: public, max-age=60. Animation HTML advertises public, max-age=300. Sampled PNGs advertise public, max-age=60. All sampled routes include Access-Control-Allow-Origin: *, X-Content-Type-Options: nosniff and Referrer-Policy: strict-origin-when-cross-origin. No X-Frame-Options or Content-Security-Policy was present on the sampled animation response. These are dated observations, not guarantees of future headers.

Animation uses fetch(cache: 'no-store') with a generated ?fresh=Date.now() for /plot/{id}, /stats and /weather; the supplied older numeric fresh value also worked. No other freshness parameter was observed. Server/CDN TTL still exists, so ?fresh is not proof of an uncached response. Preserve the response's `at` timestamp, fetch time and cache/source status separately. Automatic polling should be bounded and back off on errors; unknown or stale data should remain pending rather than becoming zeros or a reveal.

## Animation behavior and verified isolation

The production scene polls those three API routes every 15 seconds and paints once per second. It computes its own displayed share/rate using aggregate API stats; those numbers are not companion forecasts or verified wallet economics. It changes the art from the placeholder only after the API says revealed. It does not load metadata to identify the visual traits.

A fresh Chromium context opened the live companion, then embedded /animation/346.html using only sandbox="allow-scripts" and referrerpolicy="no-referrer". The wrapped scene and image loaded successfully; no page errors occurred. The frame loaded Google Fonts and a Cloudflare beacon. Its three API reads and remote scripts stayed inside the isolated frame, without same-origin or wallet privileges. The frame must remain click-to-play and be removed to stop polling.

Evidence: browser-framing.json and sandbox-preview.png. The injected frame existed only in the research browser; the deployed site was not modified.

The guessed main-site /plot/346 page returned 404 (County line). Do not construct that as a supported user destination based on the API's external_url. The canonical API animation and existing rh.farm farm UI remain the evidenced destinations.
