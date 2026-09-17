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

/// @notice MasterChef-style $CROP harvest. Weight = level x rarity when planted; the weather and First Soil
///         multipliers scale the whole farm's emission rate; the Granary absorbs shortfalls and funds
///         floods, moons and First Soil. Pending harvest belongs to the plot, not the wallet.
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
    /// @notice Economy v2 (2026-09-09): every weight unit (10_000 bps) earns this much a week before weather,
    ///         while the schedule and its carry-over can pay it. `yearBudget` is the ceiling, not the payout.
    uint256 public constant RATE_PER_WEIGHT_PER_WEEK = 2_000e18;
    /// @notice First Soil: the Founding Week pays 2x the rate and the three weeks after it 1.5x, for every planted
    ///         plot, exact to the second, funded from the Granary while it lasts, on top of the weather; the
    ///         schedule ceiling bounds the base rate only (audit X-1, 2026-09-09).
    uint256 public constant FOUNDING_WEEK_BPS = 20_000;
    uint256 public constant FIRST_SOIL_BPS = 15_000;
    uint256 public constant FOUNDING_WEEK_DURATION = 1 weeks;
    uint256 public constant FIRST_SOIL_DURATION = 4 weeks;
    uint256 public immutable foundingWeekEnd;
    uint256 public immutable firstSoilEnd;

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
    /// @notice Schedule budget the rate has not used yet. Rolls forward and pays the rate above later years' budgets;
    ///         whatever is left after the four years is swept with the Granary.
    uint256 public carry;

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
        foundingWeekEnd = start + FOUNDING_WEEK_DURATION;
        firstSoilEnd = start + FIRST_SOIL_DURATION;
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
    /// @dev Ops: close the seed bag on the source being replaced (`setBagOpen(false)`) before the swap; a bag bought
    ///      on a stale source burns treasury $CROP and earns no weight (audit X-3).
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

    /// @notice After the four-year schedule the Granary has no purpose left: the owner sweeps the Granary and the
    ///         unused carry-over (F6). Accrual is settled first so every draw up to the schedule end is honoured
    ///         before anything leaves. The amount is capped at the solvency surplus (audit M3): `emitted - paidOut`
    ///         is the outstanding earned harvest and its backing can never be swept — on an under-funded contract
    ///         the sweep takes only what exceeds that liability, floored at zero (erring protocol-safe by rounding dust).
    function sweepGranary(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp <= start + YEARS * YEAR) revert TooEarly();
        _update();
        uint256 amount = granary + carry;
        uint256 balance = crop.balanceOf(address(this));
        // Saturating on BOTH terms: paidOut can exceed emitted by grindable wei dust (per-sync
        // floor() re-base credits overshoot by ~1 wei and sync is permissionless), and an
        // underflow here would brick the sweep forever.
        uint256 owed = emitted > paidOut ? emitted - paidOut : 0;
        uint256 spare = balance > owed ? balance - owed : 0;
        if (amount > spare) amount = spare;
        granary = 0;
        carry = 0;
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

    /// @dev Rate base for a segment: the per-weight rate over `dt` seconds, before any multiplier. First Soil used
    ///      to be applied here, which put it under the schedule ceiling and clipped it from ~1,822 weight units
    ///      (audit X-1); it is a multiplier on this base now, funded like the weather. The first parameter is the
    ///      segment start: unused today, kept in the signature because the base is a property of the segment.
    function _rateBase(uint256, uint256 dt) internal view returns (uint256 r) {
        r = RATE_PER_WEIGHT_PER_WEEK * totalWeight * dt / (BPS * 7 days);
    }

    /// @dev The whole multiplier on a segment's base: the weather times First Soil's soil factor (2x inside the
    ///      Founding Week, 1.5x for the three weeks after it, 1x from `firstSoilEnd`). Segments never straddle
    ///      `foundingWeekEnd` or `firstSoilEnd`, so one `from` speaks for the whole segment.
    function _multiplierAt(uint256 from) internal view returns (uint256) {
        uint256 soilBps = BPS;
        if (from < foundingWeekEnd) soilBps = FOUNDING_WEEK_BPS;
        else if (from < firstSoilEnd) soilBps = FIRST_SOIL_BPS;
        return weather.multiplierAt(from) * soilBps / BPS;
    }

    /// @dev The combined multiplier applied to one segment's base: a surplus (multiplier >= 1x, from the weather,
    ///      from First Soil or from both) draws the granary (capped by its balance), a shortfall adds to it,
    ///      exactly as the weather alone did before `_rateBase`/carry existed. Split out of `_accrueBetween` so
    ///      that loop's own locals (boundary search, the rate-vs-ceiling min) stay few enough for the legacy
    ///      (non-IR) codegen this project builds with (`foundry.toml`: `via_ir = false`).
    function _applyWeather(uint256 from, uint256 base, uint256 granaryBal)
        internal
        view
        returns (uint256 amount, uint256 drawn, uint256 added, uint256 granaryOut)
    {
        uint256 target = base * _multiplierAt(from) / BPS;
        if (target >= base) {
            drawn = target - base;
            if (drawn > granaryBal) drawn = granaryBal;
            amount = base + drawn;
            granaryOut = granaryBal - drawn;
        } else {
            added = base - target;
            amount = target;
            granaryOut = granaryBal + added;
        }
    }

    /// @dev Amount to distribute between two timestamps, split at every year, weather, Founding Week and First Soil boundary.
    ///      Per segment the schedule's share plus the carried budget is the ceiling; the rate base is what
    ///      the planted weight earns; the smaller of the two is the base `_applyWeather` then multiplies by the
    ///      weather and First Soil together. Unused schedule rolls into `carryOut`. The granary absorbs the
    ///      combined multiplier's shortfalls and funds its surpluses, so the ceiling bounds the base rate only.
    function _accrueBetween(uint256 from, uint256 to, uint256 granaryBal, uint256 carryBal)
        internal
        view
        returns (uint256 amount, uint256 drawn, uint256 added, uint256 carryOut)
    {
        while (from < to && from < start + YEARS * YEAR) {
            uint256 segEnd = _nextYearBoundary(from);
            {
                uint256 wb = weather.nextBoundaryAfter(from);
                if (wb > from && wb < segEnd) segEnd = wb;
            }
            if (from < foundingWeekEnd && foundingWeekEnd < segEnd) segEnd = foundingWeekEnd;
            if (from < firstSoilEnd && firstSoilEnd < segEnd) segEnd = firstSoilEnd;
            if (to < segEnd) segEnd = to;
            uint256 base = _rateBase(from, segEnd - from);
            // carryBal is reused in place as `avail` (sched + carry-in): same arithmetic as
            // avail = sched + carryBal; base = min(rateBase, avail); carryBal = avail - base.
            carryBal += baseRatePerSec(from) * (segEnd - from);
            if (base > carryBal) base = carryBal;
            carryBal -= base;
            if (base != 0) {
                (uint256 a, uint256 d, uint256 ad, uint256 g) = _applyWeather(from, base, granaryBal);
                amount += a;
                drawn += d;
                added += ad;
                granaryBal = g;
            }
            from = segEnd;
        }
        carryOut = carryBal;
    }

    function _update() internal {
        uint256 nowTs = block.timestamp;
        if (nowTs <= lastUpdate) return;
        if (totalWeight == 0) {
            carry += _baseBetween(lastUpdate, nowTs);
        } else {
            (uint256 amount, uint256 drawn, uint256 added, uint256 carryOut) =
                _accrueBetween(lastUpdate, nowTs, granary, carry);
            // F12 running balance: `granary + added` first, `- drawn` last, on purpose. Each segment's draw
            // is capped by the running balance `_accrueBetween` carries through `_applyWeather`'s
            // `granaryBal`, so this order can never underflow; `granary - drawn + added` did (panic 0x11,
            // pinned by test_Regression_DroughtAddsThenDrawn_NoUnderflow). The safety needs both halves
            // (audit SC-6): this write order here, and the per-segment cap against the running balance there.
            granary = granary + added - drawn;
            granaryDrawn += drawn;
            carry = carryOut;
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
            (uint256 amount,,,) = _accrueBetween(lastUpdate, block.timestamp, granary, carry);
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
    /// @dev `public`, not `external`: `farmRatePerSec` below calls it internally.
    function granaryNow() public view returns (uint256) {
        if (block.timestamp <= lastUpdate) return granary;
        // Economy v2 (audit E-1): the idle-schedule budget is credited to `carry` by `_update`'s
        // totalWeight == 0 branch, not to the Granary (see carryNow() below, which mirrors it). The
        // Granary does not move while nothing is planted.
        if (totalWeight == 0) return granary;
        (, uint256 drawn, uint256 added,) = _accrueBetween(lastUpdate, block.timestamp, granary, carry);
        // running balance: each segment's draw is capped by the balance at that point, so this never
        // underflows even when drawn > stored granary
        return granary + added - drawn;
    }

    /// @notice Carried schedule budget as of now.
    function carryNow() public view returns (uint256) {
        if (block.timestamp <= lastUpdate) return carry;
        if (totalWeight == 0) return carry + _baseBetween(lastUpdate, block.timestamp);
        (,,, uint256 c) = _accrueBetween(lastUpdate, block.timestamp, granary, carry);
        return c;
    }

    /// @notice The next 24 hours' accrual at the current weight, the sealed weather schedule and today's reserves,
    ///         divided by 86,400. A projection that is safe to multiply by a day; not an instantaneous rate.
    ///         A plot's share of it is `weightOf / totalWeight`.
    /// @dev Audit X-2: this used to be one second of `min(rateBase, sched + carry)`. `carry` is a stock, not a flow,
    ///      so multiplying that second by 86,400 spent the whole carry 86,400 times and over-stated a day by up to
    ///      ~11x in the ceiling-binding regime — which is the launch regime. Projecting the day itself spends every
    ///      stock (carry, the Granary) exactly once. `_accrueBetween` bounds its own `to` at the schedule end.
    function farmRatePerSec() external view returns (uint256) {
        uint256 ts = block.timestamp;
        if (totalWeight == 0 || ts < start || ts >= start + YEARS * YEAR) return 0;
        (uint256 amount,,,) = _accrueBetween(ts, ts + 1 days, granaryNow(), carryNow());
        return amount / 1 days;
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
