// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IActivationSource} from "../interfaces/IActivationSource.sol";
import {ITransferHook} from "../interfaces/ITransferHook.sol";
import {IHarvestSync} from "../interfaces/IHarvestSync.sol";

/// @notice Planting registry with two doors: 2,500 $CROP (60% burned, 40% treasury) or a seed bag in ETH (the
///         treasury burns 1,500 of its own $CROP). NFT stays in the wallet, activation clears on transfer.
contract NativeActivation is IActivationSource, ITransferHook, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE = 2_500e18;
    uint256 public constant BURN_BPS = 6_000;

    /// @notice Economy v2 (2026-09-09), the second door: a seed bag paid in ETH plants a dormant plot in one click.
    ///         The treasury's own $CROP is burned as if the plot had been planted with $CROP (the 60%; the 40%
    ///         treasury share is a no-op for the treasury's own stock). The contract never holds ETH.
    uint256 public constant BAG_BURN = 1_500e18;
    uint256 public constant MAX_BAG_PRICE = 0.01 ether;
    uint256 public bagPrice; // owner-set, evented, 0 until set
    bool public bagOpen;

    event SeedBag(uint256 indexed tokenId, address indexed by, uint256 paid);
    event BagPriceSet(uint256 price);
    event BagOpenSet(bool open);

    error BagClosed();
    error WrongPrice(uint256 paid);
    error PriceTooHigh();
    error PayFailed();

    ERC20Burnable public immutable crop;
    IERC721 public immutable nft;
    address public immutable treasury;
    IHarvestSync public emissions;

    mapping(uint256 => uint64) public since;

    event Planted(uint256 indexed tokenId, address indexed by);
    event Cleared(uint256 indexed tokenId);
    event SyncFailed(uint256 indexed tokenId);
    event EmissionsSet(address emissions);

    error NotOwner();
    error AlreadyActive();
    error NotNFT();
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

    constructor(ERC20Burnable crop_, IERC721 nft_, address treasury_, address owner_) Ownable(owner_) {
        crop = crop_;
        nft = nft_;
        treasury = treasury_;
    }

    /// @dev One-shot wiring (audit M7): a wrong nonzero target is permanent (AlreadySet) and would
    ///      brick plant's `sync` call, so zero and codeless addresses are rejected — same guards as
    ///      HarvestEmissions.setActivationSource.
    function setEmissions(IHarvestSync e) external onlyOwner {
        if (address(emissions) != address(0)) revert AlreadySet();
        if (address(e) == address(0)) revert ZeroAddress();
        if (address(e).code.length == 0) revert NotContract();
        emissions = e;
        emit EmissionsSet(address(e));
    }

    function setBagPrice(uint256 price) external onlyOwner {
        if (price > MAX_BAG_PRICE) revert PriceTooHigh();
        bagPrice = price;
        emit BagPriceSet(price);
    }

    /// @dev A zero `bagPrice` keeps the door closed whatever `bagOpen` says, so opening before pricing cannot
    ///      give bags away; price first, then open.
    ///      Ops: close the seed bag on the source being replaced (`setBagOpen(false)`) before the swap; a bag bought
    ///      on a stale source burns treasury $CROP and earns no weight (audit X-3).
    function setBagOpen(bool open) external onlyOwner {
        bagOpen = open;
        emit BagOpenSet(open);
    }

    /// @dev Same CEI as `plant`: the activation write lands before the token burn and the ETH forward. `Planted`
    ///      is emitted on both doors so every indexer that folds Planted/Cleared sees one planting vocabulary.
    function plantWithBag(uint256 tokenId) external payable nonReentrant {
        if (!bagOpen || bagPrice == 0) revert BagClosed();
        if (msg.value != bagPrice) revert WrongPrice(msg.value);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (since[tokenId] != 0) revert AlreadyActive();
        since[tokenId] = uint64(block.timestamp);
        crop.burnFrom(treasury, BAG_BURN);
        (bool ok,) = treasury.call{value: msg.value}("");
        if (!ok) revert PayFailed();
        emit Planted(tokenId, msg.sender);
        emit SeedBag(tokenId, msg.sender, msg.value);
        if (address(emissions) != address(0)) emissions.sync(tokenId);
    }

    /// @dev CEI + nonReentrant (audit M6): the activation write lands before the fee's external
    ///      token calls; the trailing sync is permissionless and idempotent.
    function plant(uint256 tokenId) external nonReentrant {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (since[tokenId] != 0) revert AlreadyActive();
        since[tokenId] = uint64(block.timestamp);
        uint256 burnAmount = FEE * BURN_BPS / 10_000;
        crop.burnFrom(msg.sender, burnAmount);
        IERC20(address(crop)).safeTransferFrom(msg.sender, treasury, FEE - burnAmount);
        emit Planted(tokenId, msg.sender);
        if (address(emissions) != address(0)) emissions.sync(tokenId);
    }

    /// @dev Clear first, then resync in try/catch with a saturating gas budget: the sync gets `gasleft() - 10k`
    ///      (0 when starved), so the catch can always emit `SyncFailed` and the hook never reverts after the clear.
    ///      Without the reserve, EIP-150 leaves the hook 1/64 of its gas when the sync runs out — enough for the
    ///      NFT's `HookFailed` catch but not for this one — and the clear would be rolled back while the transfer
    ///      completes. A bare `gasleft() - RESERVE` would underflow when starved and reopen that band.
    function afterTransfer(address, address, uint256 tokenId) external {
        if (msg.sender != address(nft)) revert NotNFT();
        if (since[tokenId] != 0) {
            since[tokenId] = 0;
            emit Cleared(tokenId);
        }
        if (address(emissions) != address(0)) {
            uint256 fwd = gasleft();
            fwd = fwd > 10_000 ? fwd - 10_000 : 0;
            try emissions.sync{gas: fwd}(tokenId) {}
            catch {
                emit SyncFailed(tokenId);
            }
        }
    }

    function isActive(uint256 tokenId) external view returns (bool) {
        return since[tokenId] != 0;
    }

    function activatedSince(uint256 tokenId) external view returns (uint64) {
        return since[tokenId];
    }
}
