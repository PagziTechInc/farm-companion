// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITransferHook {
    function afterTransfer(address from, address to, uint256 tokenId) external;
}
