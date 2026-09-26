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

/// What `openPlanting` asks the farm before it opens: is this registry the one the emissions and the plot contract listen to?
interface IActivationListener {
    function activation() external view returns (address);
}

interface IHookHost {
    function transferHook() external view returns (address);
}

/// @notice Planting registry, second edition (owner's scope, 2026-09-17): the same two doors as NativeActivation, with
///         the seed bag's rules moved out of policy and into code.
///
///           - A plot gets ONE seed bag in its life, and only for its very first planting: `everPlanted` survives every
///             transfer, where `since` does not. A plot that has been in the ground before, by either door, plants with
///             $CROP from then on, whoever holds it.
///           - Only 3,333 bags exist (`MAX_BAGS`), one for each plot of the collection.
///           - A bag costs 0.001 ETH (`BAG_PRICE`). A constant: nobody can set another price, and no keeper moves it.
///           - Nothing can be planted before the owner opens planting, once and for good (`openPlanting`): everyone
///             starts on the same announced minute. Planting before Genesis is wanted ("pre-planting"): emissions pay
///             nothing before HarvestEmissions.start whatever is in the ground.
///           - `plantMany` and `plantWithBags` plant a whole holding in one transaction, all or nothing.
///
///         Everything else is NativeActivation's, line for line: 2,500 $CROP with 60% burned and 40% to the treasury;
///         a bag burns 1,500 of the treasury's own $CROP and forwards the ETH to the treasury; the plot NFT stays in the
///         wallet; a transfer clears the planting through the NFT's hook; the contract never holds ETH or $CROP. The
///         single-plot functions, the views, the events and the errors keep their names and shapes, so the site, the API
///         and the bot read this contract exactly as they read the first one.
///
///         It becomes the farm's planting registry by `HarvestEmissions.setActivationSource` and
///         `YieldFarmNFT.setTransferHook`, both the owner's and both reversible. On an EMPTY farm pointing them back at
///         the first registry is the whole rollback. Once plots are planted here it is an emergency only (interplay
///         review, 2026-09-17): their weight stays until each is synced and then reads zero, and the fees and the bags
///         stay spent (`everPlanted` and `bagsSold` are for ever). Every door reads the two wires on every call
///         (security review, 2026-09-17): a rolled-back registry refuses to plant (`NotWired`) instead of taking
///         2,500 $CROP, or 0.001 ETH and the treasury's 1,500 $CROP, for no weight, and spending a bag for ever.
contract NativeActivationV2 is IActivationSource, ITransferHook, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE = 2_500e18;
    uint256 public constant BURN_BPS = 6_000;
    uint256 public constant BAG_BURN = 1_500e18;
    uint256 public constant BAG_PRICE = 0.001 ether;
    uint256 public constant MAX_BAGS = 3_333;
    /// @dev Bounds a batch's gas (each plot is a storage write, an event and an emissions sync). The site chunks above it.
    uint256 public constant MAX_BATCH = 50;

    ERC20Burnable public immutable crop;
    IERC721 public immutable nft;
    address public immutable treasury;
    IHarvestSync public immutable emissions;

    /// @notice False until the owner opens planting; never false again.
    bool public plantingOpen;
    /// @notice The owner's emergency switch on the ETH door alone. The $CROP door has none, as before.
    bool public bagOpen = true;
    uint256 public bagsSold;

    mapping(uint256 => uint64) public since;
    /// @notice True from a plot's first planting, by either door, for ever. The seed bag asks for false.
    mapping(uint256 => bool) public everPlanted;

    event Planted(uint256 indexed tokenId, address indexed by);
    event Cleared(uint256 indexed tokenId);
    event SyncFailed(uint256 indexed tokenId);
    event SeedBag(uint256 indexed tokenId, address indexed by, uint256 paid);
    event BagOpenSet(bool open);
    event PlantingOpened(uint256 at);

    error NotOwner();
    error AlreadyActive();
    error NotNFT();
    error ZeroAddress();
    error NotContract();
    error PlantingClosed();
    /// @notice The emissions or the plot contract listen to another registry: `openPlanting` before the switch, or
    ///         any door after a rollback.
    error NotWired();
    error BagClosed();
    error WrongPrice(uint256 paid);
    error PayFailed();
    /// @notice This plot has been planted before: its one bag is spent, or was never taken. It plants with $CROP.
    error BagSpent(uint256 tokenId);
    error SoldOut();
    error EmptyBatch();
    error BatchTooLarge(uint256 size);

    /// @dev Renounce is disabled like on every owned contract of the farm (audit 2026-09-02 T-2): a renounce before
    ///      `openPlanting` would close planting for ever.
    error RenounceDisabled();

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @dev The emissions contract exists already, so it is a constructor argument and immutable: no wiring step on
    ///      this side, and nothing an owner key could repoint. Codeless targets are refused for the reason
    ///      NativeActivation.setEmissions gave: every `sync` would revert uncaught.
    constructor(ERC20Burnable crop_, IERC721 nft_, address treasury_, IHarvestSync emissions_, address owner_) Ownable(owner_) {
        if (address(crop_) == address(0) || address(nft_) == address(0) || treasury_ == address(0) || address(emissions_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(crop_).code.length == 0 || address(nft_).code.length == 0 || address(emissions_).code.length == 0) revert NotContract();
        crop = crop_;
        nft = nft_;
        treasury = treasury_;
        emissions = emissions_;
    }

    // ---------------------------------------------------------------- owner levers: two, and neither touches a price

    /// @notice Opens both doors for good. There is no way to close planting again.
    /// @dev Refuses to open an unwired registry (compatibility review, 2026-09-17): a plot planted while the emissions
    ///      listen elsewhere would carry no weight, and one planted while the plot contract's hook points elsewhere
    ///      would stay planted through a sale. Both wires are read, not assumed.
    function openPlanting() external onlyOwner {
        if (plantingOpen) return;
        if (!_wired()) revert NotWired();
        plantingOpen = true;
        emit PlantingOpened(block.timestamp);
    }

    function setBagOpen(bool open) external onlyOwner {
        bagOpen = open;
        emit BagOpenSet(open);
    }

    // ---------------------------------------------------------------- views the site and the API already read

    /// @notice The first registry's getter, kept so every reader of `bagPrice()` works unchanged. Always BAG_PRICE.
    function bagPrice() external pure returns (uint256) {
        return BAG_PRICE;
    }

    /// @notice Bags a buyer can still get: the cap, or fewer if the treasury's allowance or balance pays for fewer
    ///         (security review, 2026-09-17: a view must not say yes to a bag the token would refuse). `bagsSold` is the
    ///         cap's own counter.
    function bagsLeft() public view returns (uint256) {
        uint256 left = MAX_BAGS - bagsSold;
        uint256 allowance = crop.allowance(treasury, address(this));
        uint256 balance = crop.balanceOf(treasury);
        uint256 funded = (allowance < balance ? allowance : balance) / BAG_BURN;
        return funded < left ? funded : left;
    }

    /// @notice Can this plot take its one seed bag right now? (planting open, door open, a funded bag left, never
    ///         planted, dormant)
    function bagAvailable(uint256 tokenId) external view returns (bool) {
        return plantingOpen && bagOpen && !everPlanted[tokenId] && since[tokenId] == 0 && bagsLeft() != 0;
    }

    function isActive(uint256 tokenId) external view returns (bool) {
        return since[tokenId] != 0;
    }

    function activatedSince(uint256 tokenId) external view returns (uint64) {
        return since[tokenId];
    }

    // ---------------------------------------------------------------- the $CROP door

    /// @dev CEI + nonReentrant (audit M6 on the first registry): the activation write lands before the token calls;
    ///      the trailing sync is permissionless and idempotent.
    function plant(uint256 tokenId) external nonReentrant {
        _requireOpen();
        _activate(tokenId);
        _takeCrop(1);
        emissions.sync(tokenId);
    }

    /// @notice Every plot of the batch, or none: one plot that is not the caller's, or already planted, reverts all.
    function plantMany(uint256[] calldata tokenIds) external nonReentrant {
        _requireOpen();
        uint256 n = _batchSize(tokenIds.length);
        for (uint256 i; i < n; ++i) {
            _activate(tokenIds[i]);
        }
        _takeCrop(n);
        emissions.syncMany(tokenIds);
    }

    // ---------------------------------------------------------------- the seed bag: 0.001 ETH, once in a plot's life

    function plantWithBag(uint256 tokenId) external payable nonReentrant {
        _bagChecks(1);
        _activateWithBag(tokenId);
        _settleBags(1);
        emissions.sync(tokenId);
    }

    /// @notice Every plot of the batch, or none: the payment must be exactly `BAG_PRICE` times the batch, and one plot
    ///         that has been planted before, is planted now, or is not the caller's reverts all.
    function plantWithBags(uint256[] calldata tokenIds) external payable nonReentrant {
        uint256 n = _batchSize(tokenIds.length);
        _bagChecks(n);
        for (uint256 i; i < n; ++i) {
            _activateWithBag(tokenIds[i]);
        }
        _settleBags(n);
        emissions.syncMany(tokenIds);
    }

    // ---------------------------------------------------------------- the transfer hook

    /// @dev NativeActivation's hook, unchanged: clear first, then resync in try/catch with a saturating gas budget, so
    ///      the catch can always emit `SyncFailed` and the hook never reverts after the clear. `everPlanted` is NOT
    ///      cleared: that is the whole point of this edition.
    function afterTransfer(address, address, uint256 tokenId) external {
        if (msg.sender != address(nft)) revert NotNFT();
        if (since[tokenId] != 0) {
            since[tokenId] = 0;
            emit Cleared(tokenId);
        }
        uint256 fwd = gasleft();
        fwd = fwd > 10_000 ? fwd - 10_000 : 0;
        try emissions.sync{gas: fwd}(tokenId) {}
        catch {
            emit SyncFailed(tokenId);
        }
    }

    // ---------------------------------------------------------------- internals

    function _batchSize(uint256 n) internal pure returns (uint256) {
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        return n;
    }

    function _activate(uint256 tokenId) internal {
        _requirePlantable(tokenId);
        _write(tokenId);
    }

    /// @dev The first registry's order (the caller's plot, then not already planted), then the bag's own condition,
    ///      read BEFORE `everPlanted` is written. The order is what the site leans on: a bag that landed while the page
    ///      lost its receipt answers AlreadyActive on the retry, which the shed counts as planted, not BagSpent.
    function _activateWithBag(uint256 tokenId) internal {
        _requirePlantable(tokenId);
        if (everPlanted[tokenId]) revert BagSpent(tokenId);
        _write(tokenId);
        emit SeedBag(tokenId, msg.sender, BAG_PRICE);
    }

    function _requirePlantable(uint256 tokenId) internal view {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (since[tokenId] != 0) revert AlreadyActive();
    }

    function _write(uint256 tokenId) internal {
        since[tokenId] = uint64(block.timestamp);
        everPlanted[tokenId] = true;
        emit Planted(tokenId, msg.sender);
    }

    /// @dev Is this registry the one the emissions and the plot contract listen to? Two reads of the farm.
    function _wired() internal view returns (bool) {
        return IActivationListener(address(emissions)).activation() == address(this) && IHookHost(address(nft)).transferHook() == address(this);
    }

    /// @dev Every door: opened by the owner, and still wired. The wires are read at every planting and not only at the
    ///      opening (security review, 2026-09-17): after a rollback an opened registry would otherwise keep taking
    ///      2,500 $CROP, or 0.001 ETH plus the treasury's 1,500 $CROP, for no weight, and spend a plot's one bag for
    ///      ever. Two view calls per transaction, whatever the batch.
    function _requireOpen() internal view {
        if (!plantingOpen) revert PlantingClosed();
        if (!_wired()) revert NotWired();
    }

    function _bagChecks(uint256 n) internal view {
        _requireOpen();
        if (!bagOpen) revert BagClosed();
        if (msg.value != BAG_PRICE * n) revert WrongPrice(msg.value);
        if (bagsSold + n > MAX_BAGS) revert SoldOut();
    }

    /// @dev After the state writes: count the bags, burn the treasury's $CROP for them, forward the ETH. The contract
    ///      holds neither between calls.
    function _settleBags(uint256 n) internal {
        bagsSold += n;
        crop.burnFrom(treasury, BAG_BURN * n);
        (bool ok,) = treasury.call{value: msg.value}("");
        if (!ok) revert PayFailed();
    }

    function _takeCrop(uint256 n) internal {
        uint256 total = FEE * n;
        uint256 burnAmount = total * BURN_BPS / 10_000;
        crop.burnFrom(msg.sender, burnAmount);
        IERC20(address(crop)).safeTransferFrom(msg.sender, treasury, total - burnAmount);
    }
}
