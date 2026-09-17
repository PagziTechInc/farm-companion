# Revealed plots awaiting earning-tier finalization

At Robinhood Chain block **64,012,808** (September 15, 2026, **22:36:53 UTC**), the reviewed NFT runtime and manifest commitment matched the cached review, supply was **3,333**, and `startingIndex()` was **1,827**. `tiersFinalized()` remained **false**. This is a dated observation, not a promise about later blocks. Private RPC evidence is retained under `.local-deploy/pending-tier-review/chain-state.json`.

Revealed artwork and a positive offset establish the committed manifest mapping. They do not establish finalized economic tiers: `rarityTier()` can still return default Common values and the API can report `Pending`. Keep confirmed rarity null until finalization and manifest agreement. The manifest row is `(tokenId - 1 + startingIndex) % 3333`.

Version 2.9.1 supports a separately labeled forecast preview from that committed mapping, requiring reviewed runtime, matching manifest, positive offset, and complete owned plot observations from the same block and time. Public forecasts and upgrade comparisons use an isolated clone. Pending/false verification flags remain false. Other read failures, unsynchronized weights and rule conflicts still block calculation.

Dormant holdings earn zero. The optional planting scenario assumes all planting paid from separate capital, reports the full planting cost, and excludes that cost from gross harvest. Actual holdings and wallet balances remain unchanged. Preview copies cannot enter transaction preparation or active action plans; live investments still require fresh finalized on-chain tiers. Independently verified claims keep their existing behavior.

An unfinished collection-wide finalization is one warning. Cosmetic metadata failures are recorded separately from economic errors. Public RPC attempts share a three-request queue with spacing, bounded transient retries and bounded `Retry-After` delays. Retries retain the original block tag.
