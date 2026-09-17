# Production assets — September 14, 2026

The user supplied `/animation/346.html` and `/plot/1?fresh=1789355042929` on `https://api.rh.farm`. The timestamp is a cache-busting example, not a fixed asset revision. Use current timestamps on GETs and treat returned `at` values as separate observations.

`/plot/{id}` is live display JSON, not NFT metadata. `/metadata/{id}` provides artwork traits and links. At this inspection, tokens 1, 346 and 3333 all reported `revealed:false`, null tiers/weights and placeholder metadata (`Status: Unrevealed`, shared `image/unrevealed.png`, no animation_url). Canonical animation exists before reveal. Token-specific `/image/346.png?s=1db` returned bytes identical to the placeholder; HTTP 200 or matching paths cannot prove revealed pixels. No actual revealed production metadata was observed.

After reveal, production images are expected at `/image/{id}.png`, with the animation's observed state revision `?s=[1-5][pd]b`. Canonical animation is `/animation/{id}.html`. Production `?r` image revisions have not been observed and are not accepted. Rehearsal stays separately allowlisted, including its observed `?r` format. Six visual traits are expected from the existing metadata schema; a missing or placeholder schema stays pending rather than fabricated. Legitimate visual `None` values remain valid.

The collector first checks chain 4663 at one fresh block: reviewed NFT runtime, committed manifest and valid positive startingIndex. It then requires exact live tokenId, explicit revealed:true and real metadata before collecting each asset. It can start after a deadline-triggered reveal without full sellout; collection does not establish mint ownership. Finalized tiers are independently required for economic advice, not a prerequisite for preserving already-revealed artwork.

The watcher is isolated on the companion VPS, with bounded requests, retries, atomic checkpoints and private raw observations. Public collection files contain only normalized display metadata and status. Images/remote scripts are not downloaded or executed by the collector. The website and plugins open animations only in the existing isolated click-to-play iframe.

JSON/image responses currently cache for 60 seconds and animation HTML for 300 seconds. Public CORS allows reads; sandbox=allow-scripts with no-referrer worked in the deployed companion origin. Remote fonts and beacon remain confined to the preview. These observations do not guarantee future schema or availability.

Evidence: [complete dated archive](snapshots/production-assets-2026-09-14/SUMMARY.md), [retrieval hashes](snapshots/production-assets-2026-09-14/fetches.json), [sandbox check](snapshots/production-assets-2026-09-14/browser-framing.json).


## September 15 mint progress

Production live endpoints for 1 and 346 still report `revealed:false`, null tier/weight and unfinalized tiers. Metadata now supplies canonical `animation_url` while retaining `Status: Unrevealed` and the shared placeholder image. This is a confirmed schema difference from September 14, not a reveal signal. The existing live flag, real-trait and chain-offset gates remain necessary.

A separately pinned block 63958680 observed 2290 minted plots and startingIndex zero. The hosted collector was correctly waiting with zero collected assets. The public status panel can show validated mint progress separately from collection progress. Counts are historical observations and refresh from the collector. [Dated source/API review](snapshots/rate-review-2026-09-15/SUMMARY.md).
