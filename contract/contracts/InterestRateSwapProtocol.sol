// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {SwapManager} from "./SwapManager.sol";
import {SwapPool} from "./SwapPool.sol";
import {RateOracle} from "./RateOracle.sol";
import {SettlementEngine} from "./SettlementEngine.sol";

/// @title InterestRateSwapProtocol — Main entry point for the confidential IRS protocol
///
/// @notice Orchestrates all sub-contracts.  This is the only contract users need to
///         interact with for swap lifecycle operations.  Collateral management is done
///         directly on SettlementEngine (so operator/token ACL is set correctly).
///
/// Privacy guarantees
/// ──────────────────
///   After this upgrade, on-chain observers cannot see:
///     • Notional amount        (encrypted at initiation)
///     • Fixed rate agreed      (encrypted at initiation)
///     • Who pays at settlement (FHE.gt result, never decrypted on-chain)
///     • How much is paid       (FHE.mul of two encrypted values)
///
/// Encrypted input pattern (initiateSwap)
/// ────────────────────────────────────────
///   Both values are packed into ONE encrypted input batch:
///     fhevm.createEncryptedInput(protocolAddr, callerAddr)
///              .add64(notionalInMicroUsdc)   // handles[0]
///              .add64(fixedRateBps)           // handles[1]
///              .encrypt()
///   FHE.fromExternal() verifies the shared proof and returns each euint64 handle.
///   ACL grants propagate to SwapManager, SwapPool, and both counterparties.
contract InterestRateSwapProtocol is ZamaEthereumConfig {
  // ── Immutables ────────────────────────────────────────────────────────

  SwapManager public immutable swapManager;
  SwapPool public immutable swapPool;
  RateOracle public immutable rateOracle;
  SettlementEngine public immutable settlementEngine;

  // ── Events ────────────────────────────────────────────────────────────

  event SwapInitiated(
    uint256 indexed swapId, 
    address indexed party1, 
    address indexed party2, 
    uint256 termDays
  );
  // fixedRate intentionally omitted — it is encrypted

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(
    address _swapManager, 
    address _swapPool, 
    address _rateOracle, 
    address _settlementEngine
  ) {
    swapManager = SwapManager(_swapManager);
    swapPool = SwapPool(_swapPool);
    rateOracle = RateOracle(_rateOracle);
    settlementEngine = SettlementEngine(_settlementEngine);
  }

  // ── Swap lifecycle ────────────────────────────────────────────────────

  /// @notice Initiate a new interest rate swap.
  ///
  ///         BOTH notional and fixed rate are private. On-chain observers
  ///         cannot infer position size, agreed rate, or (at settlement)
  ///         which direction payment flows.
  ///
  /// @param counterparty   The floating-rate payer (other party).
  /// @param encNotional    Encrypted notional in micro-USDC.   (handles[0])
  /// @param encFixedRate   Encrypted fixed rate bps/30d period. (handles[1])
  ///                       Both handles must come from the SAME encrypted input:
  ///                         fhevm.createEncryptedInput(protocolAddr, msg.sender)
  ///                               .add64(notional)
  ///                               .add64(fixedRate)
  ///                               .encrypt()
  /// @param inputProof     Proof covering both encNotional and encFixedRate.
  /// @param termDays       Swap term in calendar days (public — just defines duration).
  /// @return swapId        Unique swap identifier.
  function initiateSwap(
    address counterparty,
    externalEuint64 encNotional,
    externalEuint64 encFixedRate,
    bytes calldata inputProof,
    uint256 termDays
  )
    external
    returns (uint256 swapId)
  {
    require(counterparty != address(0), "Invalid counterparty");
    require(counterparty != msg.sender, "Self-swap not allowed");
    require(termDays > 0, "Invalid term");

    // Verify proofs and obtain encrypted handles (shared proof, two handles).
    euint64 notional = FHE.fromExternal(encNotional, inputProof);
    euint64 fixedRate = FHE.fromExternal(encFixedRate, inputProof);

    // Grant ACL to all downstream contracts and both counterparties.
    FHE.allowThis(notional);
    FHE.allow(notional, address(swapManager));
    FHE.allow(notional, address(swapPool));
    FHE.allow(notional, msg.sender);
    FHE.allow(notional, counterparty);

    FHE.allowThis(fixedRate);
    FHE.allow(fixedRate, address(swapManager));
    FHE.allow(fixedRate, address(swapPool));
    FHE.allow(fixedRate, msg.sender);
    FHE.allow(fixedRate, counterparty);

    swapId = swapManager.createSwap(
      msg.sender, 
      counterparty, 
      notional, 
      fixedRate, 
      termDays, 
      address(swapPool)
    );

    emit SwapInitiated(swapId, msg.sender, counterparty, termDays);
  }

  /// @notice Settle a swap if the 30-day period has elapsed.
  ///         Callable by anyone (keeper-friendly).
  function settleIfDue(uint256 swapId) external {
    if (swapPool.isSettlementDue(swapId)) {
      swapPool.settleSwap(swapId);
    }
  }

  /// @notice Close a swap at maturity with final settlement.
  function closeAtMaturity(uint256 swapId) external {
    swapPool.closeAtMaturity(swapId);
  }

  /// @notice Settle multiple swaps between the same two parties in one net payment.
  ///         See SwapPool.settleNetted for full documentation.
  function settleNetted(uint256[] calldata swapIds) external {
    swapPool.settleNetted(swapIds);
  }

  // ── View helpers ──────────────────────────────────────────────────────

  /// @notice Returns public swap metadata plus a human-readable status string.
  ///         Fixed rate is intentionally excluded — it is encrypted.
  function getSwapStatus(uint256 swapId)
    external
    view
    returns (
      address party1, 
      address party2, 
      uint256 maturityDate, 
      string memory status
    )
  {
    SwapManager.InterestRateSwap memory swap = swapManager.getSwap(swapId);

    string memory statusStr;
    if (swap.status == SwapManager.SwapStatus.ACTIVE) statusStr = "ACTIVE";
    else if (swap.status == SwapManager.SwapStatus.EXPIRED) statusStr = "EXPIRED";
    else statusStr = "CLOSED";

    return (swap.party1, swap.party2, swap.endDate, statusStr);
  }

  /// @notice Returns the encrypted fixed rate handle for swapId.
  ///         Only ACL-permitted addresses (both counterparties) can decrypt off-chain:
  ///           fhevm.userDecryptEuint(FhevmType.euint64, handle, swapManagerAddr, signer)
  function getSwapFixedRate(uint256 swapId) external view returns (euint64) {
    return swapManager.getSwapFixedRate(swapId);
  }

  /// @notice Current floating rate from the oracle (bps per 30-day period).
  function getCurrentFloatingRate() external view returns (uint256) {
    return rateOracle.getCurrentRate();
  }
}
