// SPDX-License-Identifier: MIT
// Ported verbatim from lib/seadrop/src/interfaces/ITransferValidator.sol (seadrop@757590f) — only the pragma (0.8.17 -> ^0.8.24)
// and import paths changed. Diff against the vendored file when bumping the pin (lib/VENDORED.md).
pragma solidity ^0.8.24;

interface ITransferValidator721 {
    /// @notice Ensure that a transfer has been authorized for a specific tokenId
    function validateTransfer(
        address caller,
        address from,
        address to,
        uint256 tokenId
    ) external view;
}

interface ITransferValidator1155 {
    /// @notice Ensure that a transfer has been authorized for a specific amount of a specific tokenId, and reduce the transferable amount remaining
    function validateTransfer(
        address caller,
        address from,
        address to,
        uint256 tokenId,
        uint256 amount
    ) external;
}
