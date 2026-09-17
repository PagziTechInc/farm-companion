// SPDX-License-Identifier: MIT
// Ported verbatim from lib/seadrop/src/lib/ERC721TransferValidator.sol (seadrop@757590f) — only the pragma (0.8.17 -> ^0.8.24)
// and import paths changed. Diff against the vendored file when bumping the pin (lib/VENDORED.md).
pragma solidity ^0.8.24;

import { ICreatorToken } from "./ICreatorToken.sol";

/**
 * @title  ERC721TransferValidator
 * @notice Functionality to use a transfer validator.
 */
abstract contract ERC721TransferValidator is ICreatorToken {
    /// @dev Store the transfer validator. The null address means no transfer validator is set.
    address internal _transferValidator;

    /// @notice Revert with an error if the transfer validator is being set to the same address.
    error SameTransferValidator();

    /// @notice Returns the currently active transfer validator.
    ///         The null address means no transfer validator is set.
    function getTransferValidator() external view returns (address) {
        return _transferValidator;
    }

    /// @notice Set the transfer validator.
    ///         The external method that uses this must include access control.
    function _setTransferValidator(address newValidator) internal {
        address oldValidator = _transferValidator;
        if (oldValidator == newValidator) {
            revert SameTransferValidator();
        }
        _transferValidator = newValidator;
        emit TransferValidatorUpdated(oldValidator, newValidator);
    }
}
