# Deployed contract review — September 7, 2026

The Almanac remains the user's gameplay source of truth. This review records what the deployed contracts do separately, including discrepancies that affect planning. It is a targeted implementation review, not a security audit or a profit guarantee.

Six verified contract sources were obtained from the **Sourcify v2 API**. All six report exact creation and runtime matches. Their supplied on-chain runtime bytecode hashes independently match `eth_getCode` at Robinhood Chain **4663**, block **57,200,789**, timestamp **2026-09-07 22:45:01 UTC**. The source compiler was not rerun locally. Full responses, original source, SHA-256 file hashes, runtime Keccak hashes, getter results and discarded simulations are retained in [execution evidence](snapshots/execution-research-2026-09-07.json).

| Contract | Original source | Verification response |
| --- | --- | --- |
| Planting | [NativeActivation.sol](snapshots/verified-contracts/source/src/activation/NativeActivation.sol) | [Sourcify activation](https://sourcify.dev/server/v2/contract/4663/0xc023f81ec14261dabe9de17c30ae70a4c78d87a2?fields=all) |
| Upgrades | [FarmLevels.sol](snapshots/verified-contracts/source/src/FarmLevels.sol) | [Sourcify levels](https://sourcify.dev/server/v2/contract/4663/0x34a9f041dce0b8e39cc1ca7b1e32238fa5e45284?fields=all) |
| Accrual and claims | [HarvestEmissions.sol](snapshots/verified-contracts/source/src/HarvestEmissions.sol) | [Sourcify emissions](https://sourcify.dev/server/v2/contract/4663/0x3974f8d2eaaf2425fb8556b688534332adc4dacd?fields=all) |
| Weather | [WeatherOracle.sol](snapshots/verified-contracts/source/src/WeatherOracle.sol) | [Sourcify weather](https://sourcify.dev/server/v2/contract/4663/0xd45919b30bdac5f810a18434b3aac9c2d7093c67?fields=all) |
| Plots and reveal | [YieldFarmNFT.sol](snapshots/verified-contracts/source/src/YieldFarmNFT.sol) | [Sourcify NFT](https://sourcify.dev/server/v2/contract/4663/0x27af61a7227314bf8b558ec9777423a49e46600f?fields=all) |
| Token | [CropToken.sol](snapshots/verified-contracts/source/src/CropToken.sol) | [Sourcify CROP](https://sourcify.dev/server/v2/contract/4663/0x6af020c14e1f6fc7e6972a8a6590b98f756e605d?fields=all) |

## Two material differences to display

**Weather commitments do not enforce the published non-reroll promise in this deployment.** Almanac section 06 describes weeks sealed in advance. `WeatherOracle.setNext` permits the owner or keeper to replace a scheduled epoch until its 24-hour cutoff. It does not check `commitHash`, a supplied reveal preimage, or an already-scheduled flag. A discarded `eth_call` from the public owner address successfully simulated replacing already-Sunny epoch 0 with Fair; the actual chain remained Sunny before and after. No transaction or signature was submitted. Historical weather is fixed after the scheduling cutoff, but the commitment alone is not proof that future scheduled values cannot change. Keep the Almanac rule and this implementation conflict visible together. [Almanac](https://rh.farm/almanac/), [verified weather source](https://sourcify.dev/server/v2/contract/4663/0xd45919b30bdac5f810a18434b3aac9c2d7093c67?fields=all).

**Uniform cyclic-offset odds are a hypothetical model.** The Almanac specifies the cyclic mapping. The deployed `YieldFarmNFT.reveal` computes `hash % 3333` and changes result `0` to `1`. Offset 0 is therefore unreachable; offset 1 receives both residue 0 and residue 1. Under a uniformly distributed 256-bit hash, these residue weights can be calculated exactly; offset 1 is approximately twice as likely as each other reachable offset. The old uniform-3,333-offset result should remain explicitly hypothetical. The hash itself is not proven uniformly random or uninfluenced. No model establishes future owned IDs or rarity. [Almanac](https://rh.farm/almanac/), [verified NFT source](https://sourcify.dev/server/v2/contract/4663/0x27af61a7227314bf8b558ec9777423a49e46600f?fields=all).

## Actions and approvals

| Action | Actual prerequisites and effects |
| --- | --- |
| `plant(uint256)` on live activation | Caller must own the NFT and `since[id]` must be zero. Requires 2,500 CROP balance and allowance **to activation**. Burns 1,500 CROP, transfers 1,000 to the immutable treasury, and synchronizes emissions. |
| `upgrade(uint256)` on levels | Caller must own the NFT, levels must be unpaused and current level must be below 5. Requires the next incremental cost and allowance **to levels**. Burns that cost, advances one level and synchronizes emissions. |
| `claim(uint256)` / `claimMany(uint256[])` on emissions | Caller must own every supplied NFT and emissions must be unpaused. No CROP approval. Claims settle historical accrual, synchronize weights and transfer pending CROP. One invalid plot reverts the entire batch. Zero pending returns zero; duplicate IDs do not multiply rewards. |
| `approve(address,uint256)` on CROP | Sets spending allowance; this alone neither transfers CROP nor makes an unfunded game action feasible. Prepare the exact required amount and explicitly name its spender. The subsequent game action needs its own approval and fresh checks. |

Resolve `emissions.activation()` freshly and validate reviewed bytecode and linkage before preparing an action. At the recorded block, activation was `0xc023f81ec14261dabe9de17c30ae70a4c78d87a2`. Its `crop`, `nft`, `emissions` and `treasury` getters matched the known deployment. Levels and emissions links also matched; `emissions.rarity()` is the NFT address. Both upgrade and claim pauses were false.

Plant and upgrade source have **no Genesis or reveal gate**; upgrade does not require activation. The Almanac publishes planting's season opening at Genesis, so the guided plan may retain that opening as a clearly identified application policy. Do not present that policy as a contract revert. Both user wallets still had no plots, no CROP and no relevant allowances at the observation.

Public RPC accepted block-pinned `eth_call` and `eth_estimateGas`. An exact planting-allowance simulation succeeded without changing state; simulated actions on nonexistent plot #1 reverted with `OwnerQueryForNonexistentToken`. This verifies the preparation pathway, not successful game execution for future holdings. Actual wallet-paid fees and sponsorship still require current estimates and eventual receipt/payer evidence.

## Accrual, events and the Granary

The verified emission schedule uses exactly **four 365-day years**, starting at **1789948800 / September 21, 2026, 00:00 UTC**. Each annual budget is integer-divided into a per-second wei rate. Accrual splits at every year and weather boundary; the global accumulator uses `1e12` precision with integer floors. Consequently, waiting for better weather to claim does not apply the new multiplier to old rewards. [Verified emissions source](https://sourcify.dev/server/v2/contract/4663/0x3974f8d2eaaf2425fb8556b688534332adc4dacd?fields=all).

When total planted weight is zero, elapsed base emissions are added to the Granary. The first planter receives no prior unallocated backlog. Below-base weather replenishes the Granary; above-base weather can draw only its remaining balance. With an empty Granary, above-base reward falls back to base. `granaryNow()` includes pending settlement; it returned **40,000,000 CROP** at the recorded prelaunch block.

`multiplierAt` applies weekly weather, doubles once for a covering Flood and once for a covering Moon, then caps at 20,000 BPS. A Flood and Moon can overlap; in Locusts, their combined nominal multiplier reaches 2×. Flood duration is 24 hours, Moon duration 48 hours. Moon notice is at least 30 days and spacing at least 27 days. Unscheduled weather carries the most recent scheduled value within 52 preceding epochs, otherwise Fair. Future carry-forward getters still do not prove a future epoch has its own fixed schedule. [Verified weather source](https://sourcify.dev/server/v2/contract/4663/0xd45919b30bdac5f810a18434b3aac9c2d7093c67?fields=all).

Claims being paused does not pause the accumulator or pending views. Levels have their own independent pause. Contract solvency, future settings and activation-source changes remain live conditions to monitor.

## Reveal, tiers and weight consistency

The actual immutable `revealDeadline()` is **1789754400 / September 18, 2026, 18:00 UTC**. Permissionless reveal can occur after sellout's required later block or once this deadline arrives; it still requires a transaction. Calendar time is not proof of reveal. `startingIndex == 0` is unrevealed in this deployed implementation. At the recorded block, it was zero and `tiersFinalized` was false.

The owner writes each `rarityTier` after reveal and can revise it until finalization. The setter does not itself verify manifest contents or synchronize reward weights. A default zero tier is therefore not sufficient proof of Common rarity. Compare finalized direct tiers, the committed manifest row, and `desiredWeight` versus `weightOf` before prioritizing a rare upgrade. A disagreement should become an action blocker or synchronization notice, not a silent correction.

The NFT's current transfer hook is NativeActivation; its separate activation clearer is zero. NativeActivation clears planting and attempts a reward synchronization on transfer. Hook errors are caught, so stale recorded weight can exist until a later synchronization. `sync` and `syncMany` are permissionless, and claims also synchronize. Moving active plots still carries the published replanting cost and should not become the default funding mechanism.

## Still unavailable

This review does not establish final fertilizer/tarp pricing and mechanics, drawing ticket odds and prices, exact vesting contracts, executable CROP liquidity, or future network sponsorship. It does not reproduce the project's audits. These remain explicit inputs or unresolved questions; none is assigned a free price, guaranteed benefit or guaranteed outcome.
