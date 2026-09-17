// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFarmLevels {
    function levelOf(uint256 tokenId) external view returns (uint8);
}
