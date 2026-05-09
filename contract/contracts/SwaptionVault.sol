// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {SwapManager} from "./SwapManager.sol";
import {RateOracle} from "./RateOracle.sol";

/// @title SwaptionVault — Confidential option to enter an interest rate swap
///
/// @notice A "payer swaption" grants the buyer the right (not obligation) to enter
///         a fixed-for-floating interest rate swap at an ENCRYPTED strike rate.
///
/// Privacy model
/// ─────────────
///   • Strike rate : euint64 — never revealed on-chain.
///   • Notional    : euint64 — never revealed on-chain.
///   • Exercise signal: when out of the money, `effectiveNotional` is zeroed via
///     FHE.select — a zero-notional swap is created but produces no cash flows.
///     On-chain observers CANNOT distinguish an in-money exercise from an
///     out-of-money one: both result in a SwapCreated event.
///
/// Payer swaption mechanics
/// ────────────────────────
///   Buyer holds the right to PAY fixed (at strikeRate) and RECEIVE floating.
///   In the money (ITM) when: currentFloating > strikeRate
///     → buyer locks in paying the lower strike rather than current floating.
///   Out of the money (OTM) when: currentFloating ≤ strikeRate
///     → swap is still created but with effectiveNotional = 0 (harmless).
///
/// Lifecycle
/// ─────────
///   1. Writer calls writeSwaption()   — encrypts strike + notional, defines expiry.
///   2. Buyer calls exerciseSwaption() — FHE checks ITM, creates swap (always).
///   3. After expiry the swaption lapses; lapseSwaption() optionally formalises it.
///
/// Integration
/// ───────────
///   SwaptionVault must be authorised on SwapManager before first use:
///     swapManager.authorise(swaptionVaultAddress)
contract SwaptionVault is ZamaEthereumConfig {
  // ── Structs ───────────────────────────────────────────────────────────

  struct Swaption {
    uint256 swaptionId;
    address writer;       // grants the option (fixed-rate obligation seller)
    address buyer;        // holds the option (may exercise)
    euint64 strikeRate;   // encrypted fixed rate in bps per 30-day period
    euint64 notional;     // encrypted notional in micro-USDC
    uint256 expiry;       // unix timestamp — option lapses after this
    uint256 swapTermDays; // if exercised, resulting swap runs for this many days
    bool    exercised;    // true once exerciseSwaption() or lapseSwaption() is called
  }

  // ── State ─────────────────────────────────────────────────────────────

  mapping(uint256 => Swaption) private _swaptions;
  uint256 public nextSwaptionId = 1;

  SwapManager public immutable swapManager;
  RateOracle  public immutable rateOracle;
  address     public immutable swapPool;

  // ── Events ────────────────────────────────────────────────────────────

  /// @dev Strike and notional intentionally omitted — they are encrypted.
  event SwaptionWritten(
    uint256 indexed swaptionId,
    address indexed writer,
    address indexed buyer,
    uint256 expiry
  );

  /// @dev swapId is the resulting IRS position.  In/out-of-money is NOT revealed.
  event SwaptionExercised(uint256 indexed swaptionId, uint256 indexed swapId);

  event SwaptionLapsed(uint256 indexed swaptionId);

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(address _swapManager, address _rateOracle, address _swapPool) {
    swapManager = SwapManager(_swapManager);
    rateOracle  = RateOracle(_rateOracle);
    swapPool    = _swapPool;
  }

  // ── Write ─────────────────────────────────────────────────────────────

  /// @notice Write a payer swaption granting `buyer` the right to enter a
  ///         fixed-for-floating swap at the encrypted strike rate.
  ///
  ///         Off-chain encrypted input must pack TWO values:
  ///           fhevm.createEncryptedInput(swaptionVaultAddr, msg.sender)
  ///                  .add64(strikeRateBps)   // handles[0]
  ///                  .add64(notionalMicro)   // handles[1]
  ///                  .encrypt()
  ///
  /// @param buyer         Address that may exercise this swaption.
  /// @param encStrike     Encrypted strike rate in bps per 30-day period.
  /// @param encNotional   Encrypted notional in micro-USDC.
  /// @param inputProof    Proof covering both encStrike and encNotional.
  /// @param expiry        Unix timestamp — option lapses after this.
  /// @param swapTermDays  Duration in days of the swap if exercised.
  /// @return swaptionId   Unique identifier for this swaption.
  function writeSwaption(
    address buyer,
    externalEuint64 encStrike,
    externalEuint64 encNotional,
    bytes calldata inputProof,
    uint256 expiry,
    uint256 swapTermDays
  ) external returns (uint256 swaptionId) {
    require(buyer != address(0) && buyer != msg.sender, "Invalid buyer");
    require(expiry > block.timestamp, "Expiry in past");
    require(swapTermDays > 0, "Invalid swap term");

    euint64 strikeRate = FHE.fromExternal(encStrike,   inputProof);
    euint64 notional   = FHE.fromExternal(encNotional, inputProof);

    // Persist ACL so vault can use both handles across transactions.
    FHE.allowThis(strikeRate);
    FHE.allow(strikeRate, msg.sender);
    FHE.allow(strikeRate, buyer);

    FHE.allowThis(notional);
    FHE.allow(notional, msg.sender);
    FHE.allow(notional, buyer);

    swaptionId = nextSwaptionId++;
    _swaptions[swaptionId] = Swaption({
      swaptionId:   swaptionId,
      writer:       msg.sender,
      buyer:        buyer,
      strikeRate:   strikeRate,
      notional:     notional,
      expiry:       expiry,
      swapTermDays: swapTermDays,
      exercised:    false
    });

    emit SwaptionWritten(swaptionId, msg.sender, buyer, expiry);
  }

  // ── Exercise ──────────────────────────────────────────────────────────

  /// @notice Exercise a payer swaption.
  ///
  ///         A swap is ALWAYS created — but its effective notional is encrypted:
  ///           ITM (floating > strike): effectiveNotional = swaption.notional
  ///           OTM (floating ≤ strike): effectiveNotional = 0  (FHE.select)
  ///
  ///         The on-chain footprint (gas, events, swap creation) is identical in both
  ///         cases.  An observer cannot infer whether exercise was profitable.
  ///
  ///         buyer = fixed-rate payer (party1) in the resulting swap.
  ///         writer = floating-rate payer (party2) in the resulting swap.
  ///
  /// @param swaptionId  Swaption to exercise.
  /// @return swapId     ID of the newly created IRS position.
  function exerciseSwaption(uint256 swaptionId) external returns (uint256 swapId) {
    Swaption storage s = _swaptions[swaptionId];
    require(msg.sender == s.buyer, "Not buyer");
    require(!s.exercised, "Already exercised");
    require(block.timestamp < s.expiry, "Swaption expired");

    s.exercised = true;

    uint256 floatingRate = rateOracle.getCurrentRate();
    euint64 encFloating  = FHE.asEuint64(uint64(floatingRate));

    // ITM when floating > strike (buyer benefits by paying lower fixed).
    ebool   inTheMoney        = FHE.gt(encFloating, s.strikeRate);
    euint64 effectiveNotional = FHE.select(inTheMoney, s.notional, FHE.asEuint64(0));

    // Grant ACL to all downstream contracts and both counterparties.
    FHE.allowThis(effectiveNotional);
    FHE.allow(effectiveNotional, address(swapManager));
    FHE.allow(effectiveNotional, swapPool);
    FHE.allow(effectiveNotional, s.buyer);
    FHE.allow(effectiveNotional, s.writer);

    FHE.allowThis(s.strikeRate);
    FHE.allow(s.strikeRate, address(swapManager));
    FHE.allow(s.strikeRate, swapPool);
    FHE.allow(s.strikeRate, s.buyer);
    FHE.allow(s.strikeRate, s.writer);

    // buyer = party1 (pays fixed at strikeRate), writer = party2 (receives fixed).
    swapId = swapManager.createSwap(
      s.buyer,
      s.writer,
      effectiveNotional,
      s.strikeRate,
      s.swapTermDays,
      swapPool
    );

    emit SwaptionExercised(swaptionId, swapId);
  }

  /// @notice Mark a lapsed swaption as expired (optional cleanup call by anyone).
  function lapseSwaption(uint256 swaptionId) external {
    Swaption storage s = _swaptions[swaptionId];
    require(!s.exercised, "Already exercised");
    require(block.timestamp >= s.expiry, "Not yet expired");
    s.exercised = true;
    emit SwaptionLapsed(swaptionId);
  }

  // ── View helpers ──────────────────────────────────────────────────────

  function getSwaptionBuyer(uint256 swaptionId)   external view returns (address) { return _swaptions[swaptionId].buyer; }
  function getSwaptionWriter(uint256 swaptionId)  external view returns (address) { return _swaptions[swaptionId].writer; }
  function isExercised(uint256 swaptionId)        external view returns (bool)    { return _swaptions[swaptionId].exercised; }
  function getSwaptionExpiry(uint256 swaptionId)  external view returns (uint256) { return _swaptions[swaptionId].expiry; }

  /// @notice Encrypted strike rate handle — only ACL-permitted parties can decrypt.
  function getStrikeRate(uint256 swaptionId) external view returns (euint64) {
    return _swaptions[swaptionId].strikeRate;
  }
}
