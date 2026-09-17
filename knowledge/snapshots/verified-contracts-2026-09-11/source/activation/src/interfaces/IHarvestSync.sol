// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHarvestSync {
    function sync(uint256 tokenId) external;
    function syncMany(uint256[] calldata tokenIds) external;
}
