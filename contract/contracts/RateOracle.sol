// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RateOracle — Floating interest rate feed for IRS (mock SOFR/LIBOR)
/// @notice Rate is stored in **basis points per 30-day settlement period**.
///         Example: 41 bps per period ≈ 5 % annual (500 / 365 × 30 ≈ 41).
///         This avoids any on-chain division: the period rate is used directly
///         by SwapPool's FHE multiplication.
contract RateOracle {
  /// @dev Max 10 % per period (1 000 bps) — circuit-breaker ceiling.
  uint256 public constant MAX_RATE = 1000;

  uint256 public currentRate = 41; // ~5 % annual expressed as 30-day bps
  uint256 public lastUpdated;
  mapping(uint256 => uint256) public rateHistory;

  address public immutable owner;

  event RateUpdated(uint256 newRate, uint256 timestamp);

  modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _;
  }

  constructor() {
    owner = msg.sender;
    lastUpdated = block.timestamp;
  }

  /// @notice Returns the current floating rate in bps per settlement period.
  function getCurrentRate() external view returns (uint256) {
    return currentRate;
  }

  /// @notice Update the floating rate. In production this would be gated to
  ///         an authorised price reporter / Chainlink adapter.
  function setRate(uint256 newRate) external onlyOwner {
    require(newRate <= MAX_RATE, "Rate above ceiling");
    rateHistory[block.timestamp] = currentRate; // snapshot old rate first
    currentRate = newRate;
    lastUpdated = block.timestamp;
    emit RateUpdated(newRate, block.timestamp);
  }

  /// @notice Historical rate snapshot at a given timestamp.
  function getRateAt(uint256 timestamp) external view returns (uint256) {
    return rateHistory[timestamp];
  }
}
