// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRarityTier {
    /// @return 0 Common, 1 Fertile, 2 Prize Plot, 3 Golden Acre
    function rarityTier(uint256 tokenId) external view returns (uint8);
}
