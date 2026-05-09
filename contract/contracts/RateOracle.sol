// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface AggregatorV3Interface {
  function decimals() external view returns (uint8);
  function latestRoundData()
    external view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}

/// @title RateOracle — Chainlink-backed floating rate feed for IRS
///
/// @notice Rate is stored in **basis points per 30-day settlement period**.
///         Example: 41 bps per period ≈ 5 % annual (500 / 365 × 30 ≈ 41).
///
/// Chainlink source (Sepolia ETH/USD)
/// ───────────────────────────────────
///   Feed   : 0x694AA1769357215DE4FAC081bf1f309aDC325306
///   Decimals: 8  (e.g. $2 000 → 200_000_000_00)
///
///   Conversion to 30-day bps:
///     rate_bps = ethPrice_usd / RATE_DIVISOR
///   where RATE_DIVISOR = 50 gives:
///     $1 000 ETH →  20 bps ≈ 2.4 % annual
///     $2 000 ETH →  40 bps ≈ 4.8 % annual
///     $3 000 ETH →  60 bps ≈ 7.2 % annual
///     $5 000 ETH → 100 bps ≈ 12 % annual
///
/// The Chainlink rate is used as the *live* floating rate. The owner may also
/// set an override rate (e.g. to simulate SOFR in demos). Override takes
/// precedence when non-zero.
contract RateOracle {
  // ── Constants ─────────────────────────────────────────────────────────

  /// @dev Chainlink ETH/USD feed on Sepolia.
  address public constant FEED_ADDRESS = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

  /// @dev Maximum age before a Chainlink price is treated as stale.
  uint256 public constant STALENESS_THRESHOLD = 1 hours;

  /// @dev Divides USD price (integer, no decimals) to produce 30-day bps.
  ///      $2 000 / 50 = 40 bps ≈ 4.8 % annual.
  uint256 public constant RATE_DIVISOR = 50;

  /// @dev Hard ceiling: 10 % per period = 1 000 bps.
  uint256 public constant MAX_RATE = 1000;

  // ── State ─────────────────────────────────────────────────────────────

  AggregatorV3Interface public immutable priceFeed;
  address public immutable owner;

  /// @dev When non-zero, overrides the Chainlink-derived rate.
  ///      Useful for demos / emergency circuit-breaker.
  uint256 public overrideRate;

  mapping(uint256 => uint256) public rateHistory;

  // ── Events ────────────────────────────────────────────────────────────

  event OverrideRateSet(uint256 newRate, uint256 timestamp);
  event OverrideRateCleared(uint256 timestamp);

  // ── Constructor ───────────────────────────────────────────────────────

  modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _;
  }

  constructor() {
    owner = msg.sender;
    priceFeed = AggregatorV3Interface(FEED_ADDRESS);
  }

  // ── Read ──────────────────────────────────────────────────────────────

  /// @notice Returns the current floating rate in bps per 30-day period.
  ///         Uses the Chainlink ETH/USD feed unless an override is set.
  function getCurrentRate() external view returns (uint256) {
    if (overrideRate != 0) return overrideRate;
    return _chainlinkRate();
  }

  /// @notice Raw Chainlink-derived rate regardless of any override.
  function getChainlinkRate() external view returns (uint256) {
    return _chainlinkRate();
  }

  /// @notice Latest ETH/USD price with 8-decimal precision (raw Chainlink).
  function getEthUsdPrice() external view returns (uint256) {
    (, int256 price,, uint256 updatedAt,) = priceFeed.latestRoundData();
    require(price > 0, "Invalid price");
    require(block.timestamp - updatedAt < STALENESS_THRESHOLD, "Price feed stale");
    return uint256(price);
  }

  // ── Owner controls ────────────────────────────────────────────────────

  /// @notice Set a manual override rate (bps per 30-day period).
  ///         Pass 0 to clear and revert to the live Chainlink rate.
  function setRate(uint256 newRate) external onlyOwner {
    require(newRate <= MAX_RATE, "Rate above ceiling");
    if (newRate == 0) {
      overrideRate = 0;
      emit OverrideRateCleared(block.timestamp);
    } else {
      rateHistory[block.timestamp] = overrideRate != 0 ? overrideRate : _chainlinkRate();
      overrideRate = newRate;
      emit OverrideRateSet(newRate, block.timestamp);
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────

  function _chainlinkRate() internal view returns (uint256) {
    (, int256 price,, uint256 updatedAt,) = priceFeed.latestRoundData();
    require(price > 0, "Invalid price");
    require(block.timestamp - updatedAt < STALENESS_THRESHOLD, "Price feed stale");
    // price has 8 decimals → divide by 1e8 to get whole USD, then divide by RATE_DIVISOR
    uint256 ethUsd = uint256(price) / 1e8;
    uint256 rate = ethUsd / RATE_DIVISOR;
    // clamp to [1, MAX_RATE]
    if (rate == 0) return 1;
    if (rate > MAX_RATE) return MAX_RATE;
    return rate;
  }
}
