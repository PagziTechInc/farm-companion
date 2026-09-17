// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Anvil's `ActivationManager.clearActivation` (docs/ANVIL.md §2c): callable only by the collection
///         contract, so `YieldFarmNFT` calls it on every transfer. Idempotent when the token is not active.
interface IActivationClearer {
    function clearActivation(uint256 tokenId) external;
}
