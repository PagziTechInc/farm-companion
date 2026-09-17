// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IActivationSource} from "./interfaces/IActivationSource.sol";
import {IHarvestSync} from "./interfaces/IHarvestSync.sol";
import {IFarmLevels} from "./interfaces/IFarmLevels.sol";
import {IRarityTier} from "./interfaces/IRarityTier.sol";
import {WeatherOracle} from "./WeatherOracle.sol";

/// @notice MasterChef-style $CROP harvest. Weight = level x rarity when planted; the weather
///         multiplier scales the whole farm's emission rate; the Granary absorbs shortfalls and funds
///         floods and moons. Pending harvest belongs to the plot, not the wallet.
contract HarvestEmissions is IHarvestSync, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 private constant ACC = 1e12;
    uint256 private constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant YEARS = 4;
    /// @notice Mirrors YieldFarmNFT.MAX_SUPPLY (Solidity cannot reference another contract's
    ///         constant without an external call): the fixed 3,333-plot collection size, the
    ///         id bound for the ghost-weight guard in `_weightIfActive` (audit M4).
    uint256 public constant MAX_SUPPLY = 3333;

    IERC20 public immutable crop;
    IERC721 public immutable nft;
    IRarityTier public immutable rarity;
    IFarmLevels public immutable levels;
    WeatherOracle public immutable weather;
    uint256 public immutable start;
    IActivationSource public activation;

    uint256 public granary;
    uint256 public granaryDrawn;
    uint256 public emitted;
    /// @notice Cumulative $CROP paid out by `claim` (audit M3): `emitted - paidOut` is the
    ///         outstanding earned-but-unclaimed harvest the granary sweep must leave behind.
    uint256 public paidOut;
    uint256 public totalWeight;
    uint256 public accCropPerWeight;
    uint256 public lastUpdate;

    mapping(uint256 => uint256) public weightOf;
    mapping(uint256 => uint256) public rewardDebt;
    mapping(uint256 => uint256) public stored;

    event Synced(uint256 indexed tokenId, uint256 weight);
    event Harvested(uint256 indexed tokenId, address indexed to, uint256 amount);
    event Funded(uint256 emissionsAmount, uint256 granaryAmount);
    event GranaryAdded(address indexed from, uint256 amount);
    event ActivationSourceSet(address source);
    event ActivationSourceUnavailable(uint256 indexed tokenId);
    event GranarySwept(address indexed to, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error NotContract();
    error TooEarly();

    /// @dev Renounce is disabled: every lever on this contract stays owner-gated for the life of the
    ///      farm, and a renounce would strand them permanently (audit 2026-09-02 T-2). Rotate the key
    ///      with `transferOwnership` + `acceptOwnership` instead.
    error RenounceDisabled();

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    constructor(
        IERC20 crop_,
        IERC721 nft_,
        IFarmLevels levels_,
        WeatherOracle weather_,
        IActivationSource activation_,
        address owner_
    ) Ownable(owner_) {
        if (address(activation_).code.length == 0) revert NotContract();
        crop = crop_;
        nft = nft_;
        rarity = IRarityTier(address(nft_));
        levels = levels_;
        weather = weather_;
        activation = activation_;
        start = weather_.genesis();
        lastUpdate = start;
    }

    // ---------------------------------------------------------------- admin
    function fund(uint256 emissionsAmount, uint256 granaryAmount) external onlyOwner {
        crop.safeTransferFrom(msg.sender, address(this), emissionsAmount + granaryAmount);
        granary += granaryAmount;
        emit Funded(emissionsAmount, granaryAmount);
    }

    function addToGranary(uint256 amount) external {
        crop.safeTransferFrom(msg.sender, address(this), amount);
        granary += amount;
        emit GranaryAdded(msg.sender, amount);
    }

    /// @notice Switch the activation source (Anvil adapter / mirror / native). Ops must `syncMany` all tokens after.
    ///         A codeless address would make every `sync` revert uncaught (ABI decoding, not the call), so it is rejected.
    function setActivationSource(IActivationSource source) external onlyOwner {
        if (address(source) == address(0)) revert ZeroAddress();
        if (address(source).code.length == 0) revert NotContract();
        activation = source;
        emit ActivationSourceSet(address(source));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice After the four-year schedule the Granary has no purpose left: the owner sweeps the remainder (F6).
    ///         Accrual is settled first so every draw up to the schedule end is honoured before anything leaves.
    ///         The amount is capped at the solvency surplus (audit M3): `emitted - paidOut` is the outstanding
    ///         earned harvest and its backing can never be swept — on an under-funded contract the sweep takes
    ///         only what exceeds that liability, floored at zero (erring protocol-safe by rounding dust).
    function sweepGranary(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp <= start + YEARS * YEAR) revert TooEarly();
        _update();
        uint256 amount = granary;
        uint256 balance = crop.balanceOf(address(this));
        // Saturating on BOTH terms: paidOut can exceed emitted by grindable wei dust (per-sync
        // floor() re-base credits overshoot by ~1 wei and sync is permissionless), and an
        // underflow here would brick the sweep forever.
        uint256 owed = emitted > paidOut ? emitted - paidOut : 0;
        uint256 spare = balance > owed ? balance - owed : 0;
        if (amount > spare) amount = spare;
        granary = 0;
        crop.safeTransfer(to, amount);
        emit GranarySwept(to, amount);
    }

    // ---------------------------------------------------------------- schedule
    /// @notice 760M over four years (spec §5.1 / §15, re-denominated by §19): 380M, 190M, 95M, 95M. The 40M Granary is a reserve on top.
    function yearBudget(uint256 y) public pure returns (uint256) {
        if (y == 0) return 380_000_000e18;
        if (y == 1) return 190_000_000e18;
        if (y < YEARS) return 95_000_000e18;
        return 0;
    }

    function baseRatePerSec(uint256 ts) public view returns (uint256) {
        if (ts < start) return 0;
        return yearBudget((ts - start) / YEAR) / YEAR;
    }

    /// @notice Cumulative base budget allowed by the schedule at `ts`.
    function scheduleCap(uint256 ts) public view returns (uint256 cap) {
        if (ts <= start) return 0;
        uint256 elapsed = ts - start;
        for (uint256 y; y < YEARS; ++y) {
            if (elapsed >= (y + 1) * YEAR) {
                cap += yearBudget(y);
            } else {
                cap += yearBudget(y) * (elapsed - y * YEAR) / YEAR;
                break;
            }
        }
    }

    function levelBps(uint8 level) public pure returns (uint256) {
        if (level <= 1) return 10_000;
        if (level == 2) return 12_500;
        if (level == 3) return 15_000;
        if (level == 4) return 20_000;
        return 30_000;
    }

    function tierBps(uint8 tier) public pure returns (uint256) {
        if (tier == 1) return 12_500;
        if (tier == 2) return 15_000;
        if (tier == 3) return 20_000;
        return 10_000;
    }

    // ---------------------------------------------------------------- accrual
    /// @dev Base budget between two timestamps, split at year boundaries.
    function _baseBetween(uint256 from, uint256 to) internal view returns (uint256 base) {
        while (from < to) {
            uint256 segEnd;
            if (from < start) {
                segEnd = start;
            } else {
                segEnd = start + ((from - start) / YEAR + 1) * YEAR;
            }
            if (segEnd > to) segEnd = to;
            base += baseRatePerSec(from) * (segEnd - from);
            from = segEnd;
        }
    }

    function _nextYearBoundary(uint256 ts) internal view returns (uint256) {
        if (ts < start) return start;
        return start + ((ts - start) / YEAR + 1) * YEAR;
    }

    /// @dev Amount to distribute between two timestamps, split at every year and weather boundary so each
    ///      segment uses the exact base rate and multiplier of its moment. Segment by segment the granary
    ///      absorbs shortfalls (weather < 1x) and funds the excess (weather > 1x, floods, moons) while it lasts.
    function _accrueBetween(uint256 from, uint256 to, uint256 granaryBal)
        internal
        view
        returns (uint256 amount, uint256 drawn, uint256 added)
    {
        uint256 end = start + YEARS * YEAR;
        while (from < to && from < end) {
            uint256 segEnd = _nextYearBoundary(from);
            uint256 wb = weather.nextBoundaryAfter(from);
            if (wb > from && wb < segEnd) segEnd = wb;
            if (to < segEnd) segEnd = to;
            uint256 base = baseRatePerSec(from) * (segEnd - from);
            if (base != 0) {
                uint256 target = base * weather.multiplierAt(from) / BPS;
                if (target >= base) {
                    uint256 d = target - base;
                    if (d > granaryBal) d = granaryBal;
                    granaryBal -= d;
                    drawn += d;
                    amount += base + d;
                } else {
                    uint256 a = base - target;
                    granaryBal += a;
                    added += a;
                    amount += target;
                }
            }
            from = segEnd;
        }
    }

    function _update() internal {
        uint256 nowTs = block.timestamp;
        if (nowTs <= lastUpdate) return;
        if (totalWeight == 0) {
            granary += _baseBetween(lastUpdate, nowTs);
        } else {
            (uint256 amount, uint256 drawn, uint256 added) = _accrueBetween(lastUpdate, nowTs, granary);
            // running balance: each segment's draw is capped by the balance at that point, so this never
            // underflows even when drawn > stored granary
            granary = granary + added - drawn;
            granaryDrawn += drawn;
            if (amount > 0) {
                accCropPerWeight += amount * ACC / totalWeight;
                emitted += amount;
            }
        }
        lastUpdate = nowTs;
    }

    /// @notice Weight the plot should have right now. Reverts if the activation source does.
    function desiredWeight(uint256 tokenId) public view returns (uint256) {
        if (!activation.isActive(tokenId)) return 0;
        return _weightIfActive(tokenId);
    }

    /// @dev Ids outside the fixed 1..MAX_SUPPLY collection carry zero weight (audit M4): activation
    ///      sources are owner-swappable forever, so a buggy or hostile future source must not be able
    ///      to conjure ghost weight for ids that can never be minted. Pure range check, no external
    ///      call — the bound is the compile-time MAX_SUPPLY constant above.
    function _weightIfActive(uint256 tokenId) internal view returns (uint256) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) return 0;
        return levelBps(levels.levelOf(tokenId)) * tierBps(rarity.rarityTier(tokenId)) / BPS;
    }

    /// @dev `ok` is false when the activation source reverts (spec §8: treat the plot as unchanged).
    function _isActiveSafe(uint256 tokenId) internal view returns (bool ok, bool active) {
        try activation.isActive(tokenId) returns (bool a) {
            return (true, a);
        } catch {
            return (false, false);
        }
    }

    /// @dev Checkpoints the plot, then moves it to its desired weight. If the activation source is down the
    ///      plot is treated as unchanged: same weight, a value-neutral checkpoint (pending is identical before and
    ///      after), so nothing is lost and `claim` still pays out. It resyncs on the next call once the source is back.
    function _sync(uint256 tokenId) internal {
        uint256 w = weightOf[tokenId];
        if (w != 0) stored[tokenId] += w * accCropPerWeight / ACC - rewardDebt[tokenId];
        uint256 nw;
        (bool ok, bool active) = _isActiveSafe(tokenId);
        if (!ok) {
            nw = w;
            emit ActivationSourceUnavailable(tokenId);
        } else {
            nw = active ? _weightIfActive(tokenId) : 0;
        }
        if (nw != w) {
            totalWeight = totalWeight - w + nw;
            weightOf[tokenId] = nw;
            emit Synced(tokenId, nw);
        }
        rewardDebt[tokenId] = nw * accCropPerWeight / ACC;
    }

    /// @notice Accrue up to now without touching any plot (keepers call this at weather boundaries).
    function poke() external {
        _update();
    }

    function sync(uint256 tokenId) public {
        _update();
        _sync(tokenId);
    }

    function syncMany(uint256[] calldata tokenIds) external {
        _update();
        for (uint256 i; i < tokenIds.length; ++i) {
            _sync(tokenIds[i]);
        }
    }

    /// @dev Accumulator as of now, i.e. what the next `_update` will set it to.
    function _accNow() internal view returns (uint256 acc) {
        acc = accCropPerWeight;
        if (block.timestamp > lastUpdate && totalWeight != 0) {
            (uint256 amount,,) = _accrueBetween(lastUpdate, block.timestamp, granary);
            acc += amount * ACC / totalWeight;
        }
    }

    function _pendingAt(uint256 tokenId, uint256 acc) internal view returns (uint256) {
        uint256 w = weightOf[tokenId];
        return stored[tokenId] + (w == 0 ? 0 : w * acc / ACC - rewardDebt[tokenId]);
    }

    function pending(uint256 tokenId) external view returns (uint256) {
        return _pendingAt(tokenId, _accNow());
    }

    /// @notice Sum of `pending` over many plots with a single accrual computation.
    function pendingMany(uint256[] calldata tokenIds) external view returns (uint256 total) {
        uint256 acc = _accNow();
        for (uint256 i; i < tokenIds.length; ++i) {
            total += _pendingAt(tokenIds[i], acc);
        }
    }

    /// @notice Granary balance as of now, i.e. `granary` after the draws and additions the next update will apply.
    function granaryNow() external view returns (uint256) {
        if (block.timestamp <= lastUpdate) return granary;
        if (totalWeight == 0) return granary + _baseBetween(lastUpdate, block.timestamp);
        (, uint256 drawn, uint256 added) = _accrueBetween(lastUpdate, block.timestamp, granary);
        // running balance: each segment's draw is capped by the balance at that point, so this never
        // underflows even when drawn > stored granary
        return granary + added - drawn;
    }

    function claim(uint256 tokenId) public nonReentrant whenNotPaused returns (uint256 amount) {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        _update();
        _sync(tokenId);
        amount = stored[tokenId];
        if (amount == 0) return 0;
        stored[tokenId] = 0;
        paidOut += amount;
        crop.safeTransfer(msg.sender, amount);
        emit Harvested(tokenId, msg.sender, amount);
    }

    function claimMany(uint256[] calldata tokenIds) external returns (uint256 total) {
        for (uint256 i; i < tokenIds.length; ++i) {
            total += claim(tokenIds[i]);
        }
    }
}
