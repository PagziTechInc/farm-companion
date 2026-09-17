// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IFarmLevels} from "./interfaces/IFarmLevels.sol";
import {IHarvestSync} from "./interfaces/IHarvestSync.sol";

/// @notice Burn $CROP to raise a plot's level (1..5). Levels are permanent and travel with the plot.
contract FarmLevels is IFarmLevels, Ownable2Step, Pausable, ReentrancyGuard {
    uint8 public constant MAX_LEVEL = 5;

    ERC20Burnable public immutable crop;
    IERC721 public immutable nft;
    IHarvestSync public emissions; // set once after deployment (circular dependency)

    mapping(uint256 => uint8) private _level; // 0 means level 1

    event Upgraded(uint256 indexed tokenId, uint8 newLevel, uint256 burned);
    event EmissionsSet(address emissions);

    error NotOwner();
    error MaxLevel();
    error AlreadySet();
    error ZeroAddress();
    error NotContract();

    /// @dev Renounce is disabled: every lever on this contract stays owner-gated for the life of the
    ///      farm, and a renounce would strand them permanently (audit 2026-09-02 T-2). Rotate the key
    ///      with `transferOwnership` + `acceptOwnership` instead.
    error RenounceDisabled();

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    constructor(ERC20Burnable crop_, IERC721 nft_, address owner_) Ownable(owner_) {
        crop = crop_;
        nft = nft_;
    }

    /// @dev One-shot wiring (audit M7): a wrong nonzero target is permanent (AlreadySet) and would
    ///      brick `upgrade` at its `sync` call forever, so zero and codeless addresses are rejected —
    ///      same guards as HarvestEmissions.setActivationSource.
    function setEmissions(IHarvestSync e) external onlyOwner {
        if (address(emissions) != address(0)) revert AlreadySet();
        if (address(e) == address(0)) revert ZeroAddress();
        if (address(e).code.length == 0) revert NotContract();
        emissions = e;
        emit EmissionsSet(address(e));
    }

    /// @notice $CROP burned to reach `level` (levels 2..5).
    function costToReach(uint8 level) public pure returns (uint256) {
        if (level == 2) return 10_000e18;
        if (level == 3) return 25_000e18;
        if (level == 4) return 60_000e18;
        if (level == 5) return 150_000e18;
        return 0;
    }

    function levelOf(uint256 tokenId) public view returns (uint8) {
        uint8 l = _level[tokenId];
        return l == 0 ? 1 : l;
    }

    function upgrade(uint256 tokenId) external nonReentrant whenNotPaused {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        uint8 current = levelOf(tokenId);
        if (current >= MAX_LEVEL) revert MaxLevel();
        uint8 next = current + 1;
        uint256 cost = costToReach(next);
        crop.burnFrom(msg.sender, cost);
        _level[tokenId] = next;
        emit Upgraded(tokenId, next, cost);
        if (address(emissions) != address(0)) emissions.sync(tokenId);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
