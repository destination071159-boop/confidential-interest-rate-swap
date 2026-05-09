// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SwapManager — Storage and state machine for IRS positions
///
/// @notice The notional amount of each swap is stored as an encrypted `euint64`
///         so that on-chain observers cannot infer position sizes.  Only the two
///         counterparties and the SwapPool contract (via ACL) can decrypt it.
///
/// Unit conventions
/// ────────────────
///   • Notional  : micro-USDC (6 decimals).  1 USDC = 1_000_000.
///   • Fixed rate: basis points per 30-day settlement period.
///                 e.g. 50 bps ≈ 6 % annual  (500 / 365 × 30 ≈ 41).
contract SwapManager is ZamaEthereumConfig {
  // ── Enums ─────────────────────────────────────────────────────────────

  enum SwapStatus {
    ACTIVE,
    EXPIRED,
    CLOSED
  }

  // ── Structs ───────────────────────────────────────────────────────────

  struct InterestRateSwap {
    uint256 swapId;
    address party1; // fixed-rate payer
    address party2; // floating-rate payer
    euint64 notional; // ENCRYPTED notional (micro-USDC)
    euint64 fixedRate; // ENCRYPTED fixed rate in bps per period (confidential)
    uint256 startDate;
    uint256 endDate;
    uint256 lastSettlementDate;
    uint256 settlementPeriod; // seconds between payments (default 30 days)
    SwapStatus status;
  }

  // ── State ─────────────────────────────────────────────────────────────

  mapping(uint256 => InterestRateSwap) private _swaps;
  mapping(address => uint256[]) public userSwaps;
  uint256 public nextSwapId = 1;

  address public immutable owner;
  mapping(address => bool) public authorised;

  // ── Events ────────────────────────────────────────────────────────────

  event SwapCreated(uint256 indexed swapId, address indexed party1, address indexed party2, uint256 endDate);
  event SwapStatusUpdated(uint256 indexed swapId, SwapStatus newStatus);

  // ── Modifiers ─────────────────────────────────────────────────────────

  modifier onlyAuthorised() {
    require(authorised[msg.sender] || msg.sender == owner, "Not authorised");
    _;
  }

  // ── Constructor ───────────────────────────────────────────────────────

  constructor() {
    owner = msg.sender;
  }

  // ── Admin ─────────────────────────────────────────────────────────────

  function authorise(address account) external {
    require(msg.sender == owner, "Not owner");
    authorised[account] = true;
  }

  function deauthorise(address account) external {
    require(msg.sender == owner, "Not owner");
    authorised[account] = false;
  }

  // ── Core functions ────────────────────────────────────────────────────

  /// @notice Create a new interest rate swap. Called by the Protocol contract.
  /// @param  party1          Fixed-rate payer address.
  /// @param  party2          Floating-rate payer address.
  /// @param  notionalAmount  Encrypted notional in micro-USDC.
  /// @param  fixedRateBps    Fixed rate in bps per settlement period (≤ 1 000).
  /// @param  termDays        Swap term in days (≥ 1).
  /// @param  swapPool        Address of the SwapPool that will compute interest.
  /// @return swapId          Monotonically increasing identifier.
  function createSwap(
    address party1,
    address party2,
    euint64 notionalAmount,
    euint64 fixedRateBps,
    uint256 termDays,
    address swapPool
  )
    external
    onlyAuthorised
    returns (uint256 swapId)
  {
    require(party1 != address(0) && party2 != address(0), "Invalid party");
    require(party1 != party2, "Same party");
    require(termDays > 0, "Invalid term");

    swapId = nextSwapId++;
    uint256 startDate = block.timestamp;
    uint256 endDate = startDate + termDays * 1 days;

    // Grant ACL so this contract and the SwapPool can use both encrypted handles.
    FHE.allowThis(notionalAmount);
    FHE.allow(notionalAmount, swapPool);
    FHE.allow(notionalAmount, party1);
    FHE.allow(notionalAmount, party2);

    FHE.allowThis(fixedRateBps);
    FHE.allow(fixedRateBps, swapPool);
    FHE.allow(fixedRateBps, party1);
    FHE.allow(fixedRateBps, party2);

    _swaps[swapId] = InterestRateSwap({
      swapId: swapId,
      party1: party1,
      party2: party2,
      notional: notionalAmount,
      fixedRate: fixedRateBps,
      startDate: startDate,
      endDate: endDate,
      lastSettlementDate: startDate,
      settlementPeriod: 30 days,
      status: SwapStatus.ACTIVE
    });

    userSwaps[party1].push(swapId);
    userSwaps[party2].push(swapId);

    emit SwapCreated(swapId, party1, party2, endDate);
  }

  // ── View helpers ──────────────────────────────────────────────────────

  function getSwap(uint256 swapId) external view returns (InterestRateSwap memory) {
    return _swaps[swapId];
  }

  /// @notice Returns the encrypted notional handle. Readable only by ACL-permitted callers.
  function getSwapNotional(uint256 swapId) external view returns (euint64) {
    return _swaps[swapId].notional;
  }

  /// @notice Returns the encrypted fixed rate handle for swapId.
  ///         Only ACL-permitted addresses (both counterparties and SwapPool) can decrypt.
  function getSwapFixedRate(uint256 swapId) external view returns (euint64) {
    return _swaps[swapId].fixedRate;
  }

  function isSettlementDue(uint256 swapId) external view returns (bool) {
    InterestRateSwap storage swap = _swaps[swapId];
    require(swap.status == SwapStatus.ACTIVE, "Swap not active");
    return (block.timestamp - swap.lastSettlementDate) >= swap.settlementPeriod;
  }

  // ── State mutations called by SwapPool ────────────────────────────────

  /// @notice Advance settlement timestamp; mark EXPIRED if past endDate.
  function updateAfterSettlement(uint256 swapId) external onlyAuthorised {
    InterestRateSwap storage swap = _swaps[swapId];
    swap.lastSettlementDate = block.timestamp;
    if (block.timestamp >= swap.endDate) {
      swap.status = SwapStatus.EXPIRED;
      emit SwapStatusUpdated(swapId, SwapStatus.EXPIRED);
    }
  }

  /// @notice Mark swap as fully closed after final settlement.
  function markClosed(uint256 swapId) external onlyAuthorised {
    _swaps[swapId].status = SwapStatus.CLOSED;
    emit SwapStatusUpdated(swapId, SwapStatus.CLOSED);
  }
}
