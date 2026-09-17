// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice One weather per weekly epoch, set at least 24h ahead, bounded 0.5x–2.0x;
///         24h Flash Floods and 48h Harvest Moons stack up to the 2.0x cap.
///         Every schedule write lands strictly in the future, so `multiplierAt(ts)` is exact, immutable history
///         and `nextBoundaryAfter(ts)` lets `HarvestEmissions` split any interval at every multiplier change.
contract WeatherOracle is Ownable2Step {
    enum Weather { Fair, Sunny, Rain, Drought, Locusts }

    uint256 public constant EPOCH = 7 days;
    uint256 public constant TIMELOCK = 24 hours;
    uint256 public constant FLOOD_DURATION = 24 hours;
    uint256 public constant MOON_DURATION = 48 hours;
    uint256 public constant MOON_NOTICE = 30 days;
    uint256 public constant MOON_SPACING = 27 days;
    uint256 public constant MAX_BPS = 20_000;

    uint256 public immutable genesis; // first epoch start, a Monday 00:00 UTC
    bytes32 public immutable commitHash; // keccak256 of the pre-committed 12-week list

    mapping(uint256 => uint8) private _scheduled; // epoch => Weather + 1 (0 = unset)
    uint256 public floodStart; // most recently scheduled flood, 0 = none (drives `floodActive`)
    mapping(uint256 => uint256) public floodStartOfEpoch; // epoch => flood start, 0 = none (exact history)
    uint256[] public moons;
    address public keeper; // may run setNext/scheduleFlood alongside the owner (spec §17), 0 = unset

    event WeatherScheduled(uint256 indexed epoch, Weather weather);
    event FloodScheduled(uint256 start);
    event MoonAdded(uint256 start);
    event KeeperSet(address keeper);

    error TooLate();
    error FloodExists();
    error BadTime();
    error NotKeeper();

    /// @dev Renounce is disabled: every lever on this contract stays owner-gated for the life of the
    ///      farm, and a renounce would strand them permanently (audit 2026-09-02 T-2). Rotate the key
    ///      with `transferOwnership` + `acceptOwnership` instead.
    error RenounceDisabled();

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @param genesis_ First epoch start; must be a Monday 00:00 UTC (unix epoch is a Thursday, so `% 7 days == 4 days`).
    constructor(uint256 genesis_, bytes32 commitHash_, address owner_) Ownable(owner_) {
        if (genesis_ % EPOCH != 4 days) revert BadTime();
        genesis = genesis_;
        commitHash = commitHash_;
    }

    /// @dev Weekly ops gate: the owner (Safe) or its delegated keeper key (spec §17).
    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper) revert NotKeeper();
        _;
    }

    /// @notice Delegate `setNext`/`scheduleFlood` to `k`; zero unsets. Everything else stays owner-only.
    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function epochOf(uint256 ts) public view returns (uint256) {
        if (ts < genesis) return 0;
        return (ts - genesis) / EPOCH;
    }

    function currentEpoch() public view returns (uint256) {
        return epochOf(block.timestamp);
    }

    function epochStart(uint256 epoch) public view returns (uint256) {
        return genesis + epoch * EPOCH;
    }

    /// @notice Schedule weather for a future epoch, at least 24h before it starts.
    function setNext(uint256 epoch, Weather w) external onlyOwnerOrKeeper {
        if (block.timestamp + TIMELOCK > epochStart(epoch)) revert TooLate();
        _scheduled[epoch] = uint8(w) + 1;
        emit WeatherScheduled(epoch, w);
    }

    /// @notice Weather of an epoch; unset epochs carry the most recent scheduled weather (max 52 back), else Fair.
    function weatherOf(uint256 epoch) public view returns (Weather) {
        for (uint256 i; i <= 52; ++i) {
            if (epoch < i) break;
            uint8 s = _scheduled[epoch - i];
            if (s != 0) return Weather(s - 1);
        }
        return Weather.Fair;
    }

    /// @notice Schedule a 24h Flash Flood, at least 24h ahead and at most two epochs out. The horizon
    ///         bound (audit M8) keeps one far-future call from locking flood scheduling forever: the
    ///         FloodExists gate below blocks every new schedule until the pending flood completes and
    ///         committed events are never re-rolled, so floods must stay on their weekly ops cadence.
    function scheduleFlood(uint256 start) external onlyOwnerOrKeeper {
        if (start < genesis) revert BadTime();
        if (start < block.timestamp + TIMELOCK) revert TooLate();
        if (start > block.timestamp + 2 * EPOCH) revert BadTime();
        uint256 epoch = (start - genesis) / EPOCH;
        if (floodStartOfEpoch[epoch] != 0) revert FloodExists();
        if (floodStart != 0 && block.timestamp < floodStart + FLOOD_DURATION) revert FloodExists();
        floodStartOfEpoch[epoch] = start;
        floodStart = start;
        emit FloodScheduled(start);
    }

    /// @notice Append Harvest Moons; each at least 30 days out and at least 27 days after the previous one (monthly).
    function addMoons(uint256[] calldata starts) external onlyOwner {
        for (uint256 i; i < starts.length; ++i) {
            uint256 s = starts[i];
            if (s < block.timestamp + MOON_NOTICE) revert TooLate();
            if (moons.length != 0 && s < moons[moons.length - 1] + MOON_SPACING) revert BadTime();
            moons.push(s);
            emit MoonAdded(s);
        }
    }

    function moonCount() external view returns (uint256) {
        return moons.length;
    }

    function floodActive() public view returns (bool) {
        return floodStart != 0 && block.timestamp >= floodStart && block.timestamp < floodStart + FLOOD_DURATION;
    }

    function moonActive() public view returns (bool) {
        return _moonCovers(block.timestamp);
    }

    /// @dev A flood covers `ts` if it started in ts's epoch or spilled over from the previous one (24h < 7 days).
    function _floodCovers(uint256 ts) internal view returns (bool) {
        uint256 e = epochOf(ts);
        uint256 s = floodStartOfEpoch[e];
        if (s != 0 && ts >= s && ts < s + FLOOD_DURATION) return true;
        if (e != 0) {
            s = floodStartOfEpoch[e - 1];
            if (s != 0 && ts >= s && ts < s + FLOOD_DURATION) return true;
        }
        return false;
    }

    function _moonCovers(uint256 ts) internal view returns (bool) {
        uint256 n = moons.length;
        for (uint256 i; i < n; ++i) {
            uint256 s = moons[i];
            if (s > ts) break; // sorted ascending
            if (ts < s + MOON_DURATION) return true;
        }
        return false;
    }

    function weeklyBps(Weather w) public pure returns (uint256) {
        if (w == Weather.Sunny) return 12_000;
        if (w == Weather.Rain) return 15_000;
        if (w == Weather.Drought) return 8_000;
        if (w == Weather.Locusts) return 5_000;
        return 10_000;
    }

    /// @notice Combined multiplier in basis points at `ts` (weekly weather x flood x moon), capped at 2.0x.
    function multiplierAt(uint256 ts) public view returns (uint256 bps) {
        bps = weeklyBps(weatherOf(epochOf(ts)));
        if (_floodCovers(ts)) bps *= 2;
        if (_moonCovers(ts)) bps *= 2;
        if (bps > MAX_BPS) bps = MAX_BPS;
    }

    /// @notice Combined multiplier in basis points right now, capped at 2.0x.
    function multiplierNow() external view returns (uint256) {
        return multiplierAt(block.timestamp);
    }

    /// @notice Earliest timestamp strictly after `ts` at which the multiplier can change:
    ///         the next epoch start, a flood start/end (previous, current or next epoch) or a moon start/end.
    function nextBoundaryAfter(uint256 ts) public view returns (uint256 next) {
        if (ts < genesis) return genesis;
        uint256 e = epochOf(ts);
        next = epochStart(e + 1);
        for (uint256 i = e == 0 ? 0 : e - 1; i <= e + 1; ++i) {
            uint256 s = floodStartOfEpoch[i];
            if (s == 0) continue;
            if (s > ts && s < next) next = s;
            uint256 fe = s + FLOOD_DURATION;
            if (fe > ts && fe < next) next = fe;
        }
        uint256 n = moons.length;
        for (uint256 i; i < n; ++i) {
            uint256 s = moons[i];
            if (s >= next) break; // sorted ascending: nothing later can be earlier
            if (s > ts) next = s;
            uint256 me = s + MOON_DURATION;
            if (me > ts && me < next) next = me;
        }
    }

    /// @notice Next timestamp at which the multiplier can change (for keepers to `poke`).
    function nextBoundary() external view returns (uint256) {
        return nextBoundaryAfter(block.timestamp);
    }
}
