// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Where "planted" state comes from (Anvil registry, a keeper mirror, or our own registry).
interface IActivationSource {
    function isActive(uint256 tokenId) external view returns (bool);
    /// @return 0 when inactive
    function activatedSince(uint256 tokenId) external view returns (uint64);
}
