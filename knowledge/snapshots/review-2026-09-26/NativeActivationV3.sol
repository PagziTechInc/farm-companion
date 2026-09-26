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
import {NativeActivationV2, IActivationListener, IHookHost} from "./NativeActivationV2.sol";

/// What the constructor asks the emissions for the hour of Genesis: the oracle it took `start` from, and `start` itself.
interface IEmissionsClock {
    function weather() external view returns (address);
    function start() external view returns (uint256);
}

interface IGenesisClock {
    function genesis() external view returns (uint256);
}

/// @notice Planting registry, third edition: the second one's two doors, unchanged, and a third way to plant, "Mabel's
///         sprouts", for a plot that has been in the ground before.
///
///           - `plant` / `plantMany`: 2,500 $CROP, 60% burned and 40% to the treasury. The second registry's, line for line.
///           - `plantWithBag` / `plantWithBags`: the seed bag, 0.001 ETH (a constant), a plot's FIRST planting only, 3,333
///             in all. The cap and "one bag in a plot's life" hold ACROSS the second registry and this one: `bagsSold()`
///             is the second registry's count plus this one's, `everPlanted()` is true if either says so.
///           - `plantWithSprouts` / `plantWithSproutsMany`: `sproutPrice` ETH a plot, only for a plot that has been
///             planted before and is dormant now (the mirror image of the bag's rule: a plot is offered one or the other,
///             never both), and only from Genesis on: the hour is read from the chain at construction and nobody can
///             move it (`sproutsFrom`). The price goes to the treasury, which burns 1,500 of its own $CROP a tray exactly
///             as it does for a bag; anything sent above the price goes back to the caller in the same transaction.
///             No cap on trays. Its own switch (`sproutsOpen`), apart from `bagOpen`.
///
///         THE SWITCH CARRIES THE SECOND REGISTRY'S BOOK WITHOUT ONE TRANSACTION PER PLOT. This contract holds an
///         immutable reference to the second registry and an overlay of its own. A plot this contract has never written
///         (`recordedHere` false) reads straight through: `isActive`, `since` and `activatedSince` answer what the second
///         registry answers, so at the moment of the switch the two books agree on every plot by construction and a
///         permissionless `emissions.sync` finds nothing to change. The first time this contract plants or clears a plot
///         it writes its own record, and from then on its own record wins for that plot: that is what makes a plot
///         planted on the second registry go dormant at its first transfer after the switch, although the second
///         registry, which no longer hears about transfers, keeps its `since` for ever. Reading through is safe because
///         the second registry is FROZEN while the farm listens here: its doors answer `NotWired` the moment either wire
///         leaves it, and its hook is only ever called by the plot contract's one `transferHook`.
///
///         The order of the switch matters and the runbook (docs/pool/ACTIVATION-V3.md) keeps it: the emissions'
///         activation source FIRST, the plot contract's hook SECOND. Between the two, a transfer still clears the plot on
///         the second registry, this contract reads that through, and the weight goes to zero as it should. The other
///         order would leave a transferred plot's weight registered until somebody synced it. Planting here stays shut
///         until the owner's `openPlanting()`, which refuses an unwired registry, exactly as before.
///
///         The price of the sprouts is a stored number, and the keeper's bounds live HERE and not in a second contract
///         (the first registry needed `BagRepricer` to own it, because its only price lever was the owner's): one
///         contract to verify, the owner key stays the owner of the registry itself, and the keeper's whole blast radius
///         is one price inside one band. The owner moves the price freely above `MIN_SPROUT_PRICE` (`setSproutPrice`);
///         the keeper moves it (`repriceSprouts`) inside [`sproutMinPrice`, `sproutMaxPrice`], by at most
///         `sproutMaxStepBps` of the current price, once per `sproutCooldown`. The
///         keeper runs every hour or faster (the bag's ran every minute), so all four bounds are constructor arguments
///         and the owner's to change, a cooldown of 0 is allowed, and nothing here assumes a daily move. With a short
///         cooldown the step slows a bad key down and the BAND is what bounds it: set `sproutMaxPrice` as the most a tray may
///         ever cost without the owner's word. How the price is worked out is the keeper's arithmetic, off chain; the
///         contract stores a number. `MIN_SPROUT_PRICE` binds the owner too: a zero price would hand out plantings
///         that burn the treasury's $CROP for nothing, to anyone, without a cap.
///
///         A PRICE THAT MOVES EVERY FEW MINUTES AND AN EXACT PAYMENT DO NOT GO TOGETHER: a reprice landing between the
///         page's read and the farmer's transaction would revert every such planting. So the sprouts, unlike the bag
///         (whose price is a constant and whose payment stays exact), take `msg.value >= price x n`, forward exactly
///         `price x n` to the treasury and return the rest to the caller. What the caller sends is the most they can
///         pay: a price that rose above it answers `WrongSproutPrice(paid, due)` before anything is read or taken, carrying
///         the amount to retry with. This was chosen over the exact payment as the safer of the two: nobody can be made
///         to pay more than they signed for in either, and here an overpayment by mistake comes back instead of
///         reverting, while the one new external call (the refund) is the last thing the transaction does, after every
///         write, the burn, the forward and the emissions sync, under the reentrancy guard. A caller that refuses the
///         refund (a contract without a payable receive) reverts the whole planting (`RefundFailed`) and can pay the
///         exact price instead, which makes no refund call at all.
///
///         The single-plot functions, the views, the events and the errors keep the second registry's names and shapes,
///         so the site, the API and the bot read this contract as they read that one, at a new address. Going back is
///         the two wires pointed at the second registry again, and it is NOT clean once anything was planted or cleared
///         here: the runbook lists what disagrees and the remedy.
contract NativeActivationV3 is IActivationSource, ITransferHook, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE = 2_500e18;
    uint256 public constant BURN_BPS = 6_000;
    uint256 public constant BAG_BURN = 1_500e18;
    uint256 public constant BAG_PRICE = 0.001 ether;
    uint256 public constant MAX_BAGS = 3_333;
    /// @dev Bounds a batch's gas (each plot is a storage write, an event and an emissions sync). The site chunks above it.
    uint256 public constant MAX_BATCH = 50;
    /// @notice A tray of sprouts burns what a bag burns, from the same treasury allowance.
    uint256 public constant SPROUT_BURN = BAG_BURN;
    /// @notice Nobody, the owner included, prices a tray under a seed bag.
    uint256 public constant MIN_SPROUT_PRICE = 0.001 ether;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_SPROUT_COOLDOWN = 30 days;

    /// @notice The second registry: the book this one reads through for every plot it has not written itself.
    NativeActivationV2 public immutable previous;
    ERC20Burnable public immutable crop;
    IERC721 public immutable nft;
    address public immutable treasury;
    IHarvestSync public immutable emissions;
    /// @notice Genesis, read from the weather oracle the emissions took their `start` from, and checked against that
    ///         `start`. The sprouts door refuses before it, whatever its switch says. No setter.
    uint256 public immutable sproutsFrom;

    /// @notice False until the owner opens planting; never false again.
    bool public plantingOpen;
    /// @notice The owner's emergency switch on the seed bag alone. The $CROP door has none, as before.
    bool public bagOpen = true;
    /// @notice The owner's switch on the sprouts alone. Starts shut: the owner opens it once a price is in. It can be
    ///         opened ahead of Genesis, because the clock is the real gate.
    bool public sproutsOpen;
    /// @notice Bags sold by THIS registry. The cap counts `bagsSold()`, which adds the second registry's.
    uint256 public bagsSoldHere;
    /// @notice Trays sold. No cap: a count for the books.
    uint256 public sproutsSold;

    /// @notice What a tray costs, in wei, a plot.
    uint256 public sproutPrice;
    address public sproutKeeper;
    uint256 public sproutMinPrice;
    uint256 public sproutMaxPrice;
    uint256 public sproutMaxStepBps;
    uint256 public sproutCooldown;
    /// @notice When the keeper's door last moved the price. The owner's `setSproutPrice` does not touch it.
    uint256 public lastSproutReprice;

    /// @dev One slot a plot. `here` is the overlay's switch: false = this registry never wrote the plot, read the second
    ///      registry; true = `since` below is the truth (0 = dormant). `ever` only ever adds to the second registry's
    ///      `everPlanted`.
    struct Plot {
        uint64 since;
        bool here;
        bool ever;
    }

    mapping(uint256 => Plot) internal _plots;

    event Planted(uint256 indexed tokenId, address indexed by);
    event Cleared(uint256 indexed tokenId);
    event SyncFailed(uint256 indexed tokenId);
    event SeedBag(uint256 indexed tokenId, address indexed by, uint256 paid);
    event Sprouts(uint256 indexed tokenId, address indexed by, uint256 paid);
    event BagOpenSet(bool open);
    event SproutsOpenSet(bool open);
    event PlantingOpened(uint256 at);
    event SproutKeeperSet(address keeper);
    event SproutBoundsSet(uint256 minPrice, uint256 maxPrice, uint256 maxStepBps, uint256 cooldown);
    event SproutPriceSet(address indexed by, uint256 from, uint256 to);

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
    /// @notice This plot has been planted before, here or on the second registry: its one bag is spent, or was never
    ///         taken. It plants with $CROP, or with sprouts.
    error BagSpent(uint256 tokenId);
    error SoldOut();
    error EmptyBatch();
    error BatchTooLarge(uint256 size);
    error SproutsClosed();
    /// @notice Less than the price was sent. `price` is the WHOLE amount due now (the tray's price times the batch):
    ///         send it (or more; the rest comes back).
    error WrongSproutPrice(uint256 paid, uint256 price);
    /// @notice The caller sent more than the price and refused the change. Nothing was planted; pay the exact price.
    error RefundFailed();
    /// @notice Sprouts exist from Genesis on. `from` is `sproutsFrom`.
    error SproutsNotYet(uint256 from);
    /// @notice This plot has never been in the ground: sprouts are for a replanting. Its first planting is the seed
    ///         bag's, or $CROP's.
    error NeverPlanted(uint256 tokenId);
    /// @notice The oracle's Genesis and the emissions' `start` disagree: not the farm this registry was written for.
    error GenesisMismatch();
    error NotKeeper();
    error BadBounds();
    error OutOfBounds(uint256 price);
    error StepTooLarge(uint256 from, uint256 to);
    error TooSoon(uint256 nextAllowed);

    /// @dev Renounce is disabled like on every owned contract of the farm (audit 2026-09-02 T-2): a renounce before
    ///      `openPlanting` would close planting for ever, and after it would freeze the sprouts' price and switches.
    error RenounceDisabled();

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @dev The farm is READ from the second registry, not typed: the same $CROP, plot contract, treasury and emissions,
    ///      all immutable here as there. Genesis is read from the chain too (see `sproutsFrom`). The sprouts start at
    ///      `sproutPrice_` with their door shut.
    constructor(
        NativeActivationV2 previous_,
        address owner_,
        address keeper_,
        uint256 sproutPrice_,
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 maxStepBps_,
        uint256 cooldown_
    ) Ownable(owner_) {
        if (address(previous_) == address(0)) revert ZeroAddress();
        if (address(previous_).code.length == 0) revert NotContract();
        previous = previous_;
        crop = previous_.crop();
        nft = previous_.nft();
        treasury = previous_.treasury();
        emissions = previous_.emissions();
        uint256 genesis = IGenesisClock(IEmissionsClock(address(emissions)).weather()).genesis();
        if (genesis == 0 || genesis != IEmissionsClock(address(emissions)).start()) revert GenesisMismatch();
        sproutsFrom = genesis;
        if (sproutPrice_ < MIN_SPROUT_PRICE) revert OutOfBounds(sproutPrice_);
        sproutPrice = sproutPrice_;
        emit SproutPriceSet(msg.sender, 0, sproutPrice_);
        _setBounds(minPrice_, maxPrice_, maxStepBps_, cooldown_); // after the price: the band must hold it
        sproutKeeper = keeper_;
        emit SproutKeeperSet(keeper_);
    }

    // ---------------------------------------------------------------- owner levers

    /// @notice Opens the doors for good. There is no way to close planting again.
    /// @dev Refuses to open an unwired registry, as the second one did: a plot planted while the emissions listen
    ///      elsewhere would carry no weight, and one planted while the plot contract's hook points elsewhere would stay
    ///      planted through a sale. Both wires are read, not assumed.
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

    /// @notice The sprouts' own switch. Before Genesis an open switch sells nothing (`SproutsNotYet`).
    function setSproutsOpen(bool open) external onlyOwner {
        sproutsOpen = open;
        emit SproutsOpenSet(open);
    }

    /// @notice A zero keeper means nobody but the owner can reprice.
    function setSproutKeeper(address k) external onlyOwner {
        sproutKeeper = k;
        emit SproutKeeperSet(k);
    }

    function setSproutBounds(uint256 minPrice_, uint256 maxPrice_, uint256 maxStepBps_, uint256 cooldown_) external onlyOwner {
        _setBounds(minPrice_, maxPrice_, maxStepBps_, cooldown_);
    }

    /// @notice The owner's lever: any price, down to `MIN_SPROUT_PRICE` and no lower. It does not start the keeper's
    ///         cooldown.
    /// @dev The band binds the keeper, not the owner: this lever can put the price outside it, on purpose. While the
    ///      price sits more than one step outside the band the keeper cannot move it at all (`OutOfBounds` for a price
    ///      near it, `StepTooLarge` for a price inside the band) and a tray costs the owner's price until the owner
    ///      moves it again. `setSproutBounds` refuses to do the same thing by accident.
    function setSproutPrice(uint256 price) external onlyOwner {
        if (price < MIN_SPROUT_PRICE) revert OutOfBounds(price);
        _setPrice(price);
    }

    /// @notice The keeper's door (the owner may use it too, under the same bounds): inside [sproutMinPrice,
    ///         sproutMaxPrice], by at most sproutMaxStepBps of the current price, once per sproutCooldown (0 = every
    ///         block). BagRepricer's rule, minus its "from a zero price" case: the price here is never zero.
    /// @dev A planting signed before a reprice and mined after it pays the NEW price if what it sent covers it (the
    ///      rest comes back), and answers `WrongSproutPrice` with the amount now due if not.
    function repriceSprouts(uint256 price) external {
        if (msg.sender != sproutKeeper && msg.sender != owner()) revert NotKeeper();
        if (price < sproutMinPrice || price > sproutMaxPrice) revert OutOfBounds(price);
        uint256 nextAllowed = lastSproutReprice + sproutCooldown;
        if (block.timestamp < nextAllowed) revert TooSoon(nextAllowed);
        uint256 from = sproutPrice;
        uint256 step = from * sproutMaxStepBps / BPS;
        if (price > from + step || price + step < from) revert StepTooLarge(from, price);
        lastSproutReprice = block.timestamp;
        _setPrice(price);
    }

    // ---------------------------------------------------------------- views the site and the API already read

    /// @notice The first registry's getter, kept so every reader of `bagPrice()` works unchanged. Always BAG_PRICE.
    function bagPrice() external pure returns (uint256) {
        return BAG_PRICE;
    }

    /// @notice Every bag ever sold: the second registry's and this one's. The 3,333 cap counts this number.
    /// @dev The second registry's count is read, not copied: it keeps selling until the switch, and cannot sell after.
    function bagsSold() public view returns (uint256) {
        return previous.bagsSold() + bagsSoldHere;
    }

    /// @notice Burns the treasury can pay for right now, bags and trays alike: the smaller of its allowance to this
    ///         registry and its balance, in units of 1,500 $CROP. One allowance feeds both doors.
    function burnsFunded() public view returns (uint256) {
        uint256 allowance = crop.allowance(treasury, address(this));
        uint256 balance = crop.balanceOf(treasury);
        return (allowance < balance ? allowance : balance) / BAG_BURN;
    }

    /// @notice Bags a buyer can still get: what is left under the cap, or fewer if the treasury pays for fewer (a view
    ///         must not say yes to a bag the token would refuse).
    function bagsLeft() public view returns (uint256) {
        uint256 sold = bagsSold();
        uint256 left = sold < MAX_BAGS ? MAX_BAGS - sold : 0;
        uint256 funded = burnsFunded();
        return funded < left ? funded : left;
    }

    /// @notice Can this plot take its one seed bag right now? (planting open and the farm listening here, door open, a
    ///         funded bag left, never planted on either registry, dormant)
    /// @dev The second registry's view did not read the wires; its door did. A view must not say yes to a bag the door
    ///      would refuse (review, 2026-09-19): half-way through a rollback, or through the way forward again, this one
    ///      says no, as `sproutsAvailable` does.
    function bagAvailable(uint256 tokenId) external view returns (bool) {
        return plantingOpen && bagOpen && _wired() && !everPlanted(tokenId) && !isActive(tokenId) && bagsLeft() != 0;
    }

    /// @notice Can this plot be replanted with sprouts right now? (planting open and the farm listening here, door
    ///         open, Genesis passed, a funded tray, planted before on either registry, dormant)
    function sproutsAvailable(uint256 tokenId) external view returns (bool) {
        return plantingOpen && sproutsOpen && block.timestamp >= sproutsFrom && _wired() && everPlanted(tokenId)
            && !isActive(tokenId) && burnsFunded() != 0;
    }

    /// @notice Has this registry written the plot itself? False = every answer about it is the second registry's.
    function recordedHere(uint256 tokenId) external view returns (bool) {
        return _plots[tokenId].here;
    }

    /// @notice The second registry's mapping getter, as a function: this registry's own record once it has one, the
    ///         second registry's until then.
    function since(uint256 tokenId) public view returns (uint64) {
        Plot storage p = _plots[tokenId];
        return p.here ? p.since : previous.since(tokenId);
    }

    /// @notice True from a plot's first planting, on either registry, by any door, for ever.
    function everPlanted(uint256 tokenId) public view returns (bool) {
        return _plots[tokenId].ever || previous.everPlanted(tokenId);
    }

    function isActive(uint256 tokenId) public view returns (bool) {
        return since(tokenId) != 0;
    }

    function activatedSince(uint256 tokenId) external view returns (uint64) {
        return since(tokenId);
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

    // ---------------------------------------------------------------- Mabel's sprouts: a replanting, for ETH, from Genesis

    /// @notice Send `sproutPrice()` or more; the price is kept and the rest returned. `Sprouts.paid` is the price kept.
    function plantWithSprouts(uint256 tokenId) external payable nonReentrant {
        uint256 price = _sproutChecks(1);
        _activateWithSprouts(tokenId, price);
        _settleSprouts(1, price);
        emissions.sync(tokenId);
        _refund(price);
    }

    /// @notice Every plot of the batch, or none: the payment must cover `sproutPrice` times the batch (the rest comes
    ///         back), and one plot that has never been planted, is planted now, or is not the caller's reverts all.
    function plantWithSproutsMany(uint256[] calldata tokenIds) external payable nonReentrant {
        uint256 n = _batchSize(tokenIds.length);
        uint256 price = _sproutChecks(n);
        for (uint256 i; i < n; ++i) {
            _activateWithSprouts(tokenIds[i], price);
        }
        _settleSprouts(n, price);
        emissions.syncMany(tokenIds);
        _refund(price * n);
    }

    // ---------------------------------------------------------------- the transfer hook

    /// @dev The second registry's hook over the overlay: clear first, then resync in try/catch with a saturating gas
    ///      budget, so the catch can always emit `SyncFailed` and the hook never reverts after the clear. The clear is
    ///      this registry's own record (`here`, `since` 0): for a plot planted on the second registry that is the write
    ///      that overrides its `since` there, which nothing will ever clear. `ever` is set with it so the plot's one
    ///      slot tells its whole story; the second registry says the same. A plot that is dormant already is left
    ///      alone, read-through or not: a dormant plot on a frozen book stays dormant.
    function afterTransfer(address, address, uint256 tokenId) external {
        if (msg.sender != address(nft)) revert NotNFT();
        if (isActive(tokenId)) {
            _plots[tokenId] = Plot({since: 0, here: true, ever: true});
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
    ///      read BEFORE `ever` is written. The order is what the site leans on: a bag that landed while the page lost
    ///      its receipt answers AlreadyActive on the retry, which the shed counts as planted, not BagSpent.
    function _activateWithBag(uint256 tokenId) internal {
        _requirePlantable(tokenId);
        if (everPlanted(tokenId)) revert BagSpent(tokenId);
        _write(tokenId);
        emit SeedBag(tokenId, msg.sender, BAG_PRICE);
    }

    /// @dev The bag's order with the bag's condition turned round: the caller's plot, not planted now, planted before.
    function _activateWithSprouts(uint256 tokenId, uint256 price) internal {
        _requirePlantable(tokenId);
        if (!everPlanted(tokenId)) revert NeverPlanted(tokenId);
        _write(tokenId);
        emit Sprouts(tokenId, msg.sender, price);
    }

    function _requirePlantable(uint256 tokenId) internal view {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (isActive(tokenId)) revert AlreadyActive();
    }

    /// @dev From here this registry's record is the plot's truth.
    function _write(uint256 tokenId) internal {
        _plots[tokenId] = Plot({since: uint64(block.timestamp), here: true, ever: true});
        emit Planted(tokenId, msg.sender);
    }

    /// @dev Is this registry the one the emissions and the plot contract listen to? Two reads of the farm.
    function _wired() internal view returns (bool) {
        return IActivationListener(address(emissions)).activation() == address(this) && IHookHost(address(nft)).transferHook() == address(this);
    }

    /// @dev Every door: opened by the owner, and still wired. The wires are read at every planting and not only at the
    ///      opening (security review of the second registry, 2026-09-17): after a rollback an opened registry would
    ///      otherwise keep taking $CROP or ETH, and the treasury's 1,500 $CROP, for no weight, and spend a plot's one
    ///      bag for ever. Two view calls per transaction, whatever the batch.
    function _requireOpen() internal view {
        if (!plantingOpen) revert PlantingClosed();
        if (!_wired()) revert NotWired();
    }

    function _bagChecks(uint256 n) internal view {
        _requireOpen();
        if (!bagOpen) revert BagClosed();
        if (msg.value != BAG_PRICE * n) revert WrongPrice(msg.value);
        if (bagsSold() + n > MAX_BAGS) revert SoldOut();
    }

    /// @dev The clock comes after the switch and before the money: a closed door says closed, an open one before
    ///      Genesis says when. An underpayment is refused here, before any plot is read: a cheap revert with the price.
    function _sproutChecks(uint256 n) internal view returns (uint256 price) {
        _requireOpen();
        if (!sproutsOpen) revert SproutsClosed();
        if (block.timestamp < sproutsFrom) revert SproutsNotYet(sproutsFrom);
        price = sproutPrice;
        if (msg.value < price * n) revert WrongSproutPrice(msg.value, price * n);
    }

    /// @dev After the state writes: count the bags, burn the treasury's $CROP for them, forward the ETH. The contract
    ///      holds neither between calls.
    function _settleBags(uint256 n) internal {
        bagsSoldHere += n;
        _burnAndForward(BAG_BURN * n, msg.value);
    }

    /// @dev The treasury gets the price and not a wei of the caller's excess.
    function _settleSprouts(uint256 n, uint256 price) internal {
        sproutsSold += n;
        _burnAndForward(SPROUT_BURN * n, price * n);
    }

    function _burnAndForward(uint256 burnAmount, uint256 pay) internal {
        crop.burnFrom(treasury, burnAmount);
        (bool ok,) = treasury.call{value: pay}("");
        if (!ok) revert PayFailed();
    }

    /// @dev The last thing a sprouts planting does, after every write and every other call: whatever was sent above
    ///      `due` goes back to the caller. No call at all for an exact payment. The guard is still held, so the caller
    ///      cannot come back in through a door from here; what it can do (sell the plot it just planted, sync) it
    ///      could do a block later.
    function _refund(uint256 due) internal {
        uint256 excess = msg.value - due;
        if (excess == 0) return;
        (bool ok,) = msg.sender.call{value: excess}("");
        if (!ok) revert RefundFailed();
    }

    function _takeCrop(uint256 n) internal {
        uint256 total = FEE * n;
        uint256 burnAmount = total * BURN_BPS / 10_000;
        crop.burnFrom(msg.sender, burnAmount);
        IERC20(address(crop)).safeTransferFrom(msg.sender, treasury, total - burnAmount);
    }

    /// @dev The floor of the keeper's band can never go under the hard floor, so no keeper move can either. The
    ///      cooldown has no minimum (0 = a move every block: the keeper runs by the minute); its ceiling only keeps
    ///      `lastSproutReprice + sproutCooldown` from overflowing into a panic. To stop the keeper, unset it.
    ///      A band that leaves the current price outside is refused (review, 2026-09-19): it would freeze the keeper
    ///      and leave a tray dearer than the cap the owner just set. Move the price first, then the band.
    function _setBounds(uint256 minPrice_, uint256 maxPrice_, uint256 maxStepBps_, uint256 cooldown_) internal {
        if (minPrice_ < MIN_SPROUT_PRICE || maxPrice_ < minPrice_ || maxStepBps_ == 0 || maxStepBps_ > BPS || cooldown_ > MAX_SPROUT_COOLDOWN) {
            revert BadBounds();
        }
        if (sproutPrice < minPrice_ || sproutPrice > maxPrice_) revert BadBounds();
        sproutMinPrice = minPrice_;
        sproutMaxPrice = maxPrice_;
        sproutMaxStepBps = maxStepBps_;
        sproutCooldown = cooldown_;
        emit SproutBoundsSet(minPrice_, maxPrice_, maxStepBps_, cooldown_);
    }

    function _setPrice(uint256 price) internal {
        emit SproutPriceSet(msg.sender, sproutPrice, price);
        sproutPrice = price;
    }
}
