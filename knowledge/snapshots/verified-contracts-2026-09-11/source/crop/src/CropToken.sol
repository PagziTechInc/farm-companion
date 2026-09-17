// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice $CROP — fixed supply, burnable, no mint after construction.
contract CropToken is ERC20, ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 2_000_000_000e18;

    constructor(address distributor) ERC20("Yield Farm Crop", "CROP") {
        _mint(distributor, TOTAL_SUPPLY);
    }
}
