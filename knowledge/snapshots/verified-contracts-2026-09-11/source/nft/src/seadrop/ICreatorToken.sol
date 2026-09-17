// SPDX-License-Identifier: MIT
// Ported verbatim from lib/seadrop/src/interfaces/ICreatorToken.sol (seadrop@757590f) — only the pragma (0.8.17 -> ^0.8.24)
// and import paths changed. Diff against the vendored file when bumping the pin (lib/VENDORED.md).
pragma solidity ^0.8.24;

interface ICreatorToken {
    event TransferValidatorUpdated(address oldValidator, address newValidator);

    function getTransferValidator() external view returns (address validator);

    function getTransferValidationFunction()
        external
        view
        returns (bytes4 functionSignature, bool isViewFunction);

    function setTransferValidator(address validator) external;
}

interface ILegacyCreatorToken {
    event TransferValidatorUpdated(address oldValidator, address newValidator);

    function getTransferValidator() external view returns (address validator);

    function setTransferValidator(address validator) external;
}
