// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {SwapManager} from "./SwapManager.sol";
import {RateOracle} from "./RateOracle.sol";
import {SettlementEngine} from "./SettlementEngine.sol";

/// @title SwapPool — Core FHE interest computation and settlement execution
///
/// @notice This contract performs the key privacy-preserving arithmetic:
///
///   paymentScaled = FHE.mul(notional_micro, netRateBps)
///                 = actual_payment_micro × BPS_SCALE
///
///   Because fixedRate and floatingRate are **public** values, only WHO pays
///   is computable in plaintext.  HOW MUCH is paid is kept encrypted — the
///   product of the public net rate and the private encrypted notional.
///   SettlementEngine stores collateral at BPS_SCALE too, so the deduction
///   is unit-consistent without any division.
///
/// Settlement trigger
/// ──────────────────
///   Anyone may call settleSwap() after the 30-day settlement period elapses.
///   The swap's lastSettlementDate is updated; if past endDate the swap is
///   marked EXPIRED automatically.
contract SwapPool is ZamaEthereumConfig {
  // ── Immutables ────────────────────────────────────────────────────────

  SwapManager public immutable swapManager;
  RateOracle public immutable rateOracle;
  SettlementEngine public immutable settlementEngine;

  // ── Events ────────────────────────────────────────────────────────────

  /// @dev Direction (who pays) is hidden — only the swapId is emitted.
  event SwapSettled(uint256 indexed swapId);
  event SwapClosed(uint256 indexed swapId);
  /// @dev Net amount and direction hidden — only party addresses and count emitted.
  event SwapsNetted(address indexed party1, address indexed party2, uint256 swapCount);

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(
    address _swapManager, 
    address _rateOracle, 
    address _settlementEngine
  ) {
    swapManager = SwapManager(_swapManager);
    rateOracle = RateOracle(_rateOracle);
    settlementEngine = SettlementEngine(_settlementEngine);
  }

  // ── External entry points ─────────────────────────────────────────────

  /// @notice Returns true when the swap's 30-day period has elapsed.
  function isSettlementDue(uint256 swapId) external view returns (bool) {
    return swapManager.isSettlementDue(swapId);
  }

  /// @notice Execute one periodic interest settlement for swapId.
  ///
  ///         FHE core:
  ///           1. netRateBps = |fixedRate − floatingRate|  (plaintext, public)
  ///           2. paymentScaled = FHE.mul(notional, netRateBps)            (encrypted)
  ///           3. SettlementEngine deducts / credits collateral atomically (encrypted)
  ///
  ///         If netRateBps == 0 (rates equal) no transfer occurs and the
  ///         settlement date is still advanced.
  function settleSwap(uint256 swapId) public {
    SwapManager.InterestRateSwap memory swap = swapManager.getSwap(swapId);
    require(swap.status == SwapManager.SwapStatus.ACTIVE, "Swap not active");
    require(
      block.timestamp - swap.lastSettlementDate >= swap.settlementPeriod, 
      "Settlement period not elapsed"
    );

    uint256 floatingRate = rateOracle.getCurrentRate();

    // ── FHE: fully encrypted direction + payment ───────────────────────
    //
    //  notional   : private euint64 — nobody sees the position size
    //  fixedRate  : private euint64 — nobody sees the agreed rate
    //  floatingRate: public  uint256 — from RateOracle
    //
    //  1. party1Pays = FHE.gt(fixedRate, floating)            → ebool   (encrypted)
    //  2. netRate    = select(p1Pays, fixed−f, f−fixed)        → euint64 (encrypted)
    //  3. payment    = mul(notional, netRate)                  → euint64 (encrypted)
    //  4. SettlementEngine.transferPaymentDirectional uses FHE.select
    //     internally — payer identity and amount never appear in plaintext.

    euint64 notional = swapManager.getSwapNotional(swapId);
    euint64 encFloating = FHE.asEuint64(uint64(floatingRate));

    // Step 1: encrypted boolean — true when party1 (fixed payer) owes net.
    ebool party1Pays = FHE.gt(swap.fixedRate, encFloating);

    // Step 2: absolute net rate (no underflow — FHE.select picks correct branch).
    euint64 netRate = FHE.select(
      party1Pays, 
      FHE.sub(swap.fixedRate, encFloating), 
      FHE.sub(encFloating, swap.fixedRate)
    );

    // Step 3: payment = notional × netRate  (two encrypted values → encrypted result).
    euint64 paymentScaled = FHE.mul(notional, netRate);

    // Grant SettlementEngine ACL for both handles.
    FHE.allowThis(party1Pays);
    FHE.allow(party1Pays, address(settlementEngine));
    FHE.allowThis(paymentScaled);
    FHE.allow(paymentScaled, address(settlementEngine));

    // Step 4: directional settlement — direction is encrypted inside.
    settlementEngine.transferPaymentDirectional(
      swap.party1, 
      swap.party2, 
      paymentScaled, 
      party1Pays
    );
    emit SwapSettled(swapId);

    swapManager.updateAfterSettlement(swapId);
  }

  /// @notice Close a swap at maturity — performs a final settlement if due
  ///         and marks the position CLOSED.
  function closeAtMaturity(uint256 swapId) external {
    SwapManager.InterestRateSwap memory swap = swapManager.getSwap(swapId);
    require(swap.status == SwapManager.SwapStatus.ACTIVE, "Swap not active");
    require(block.timestamp >= swap.endDate, "Swap not mature");

    // Final settlement if the last period has elapsed.
    if (block.timestamp - swap.lastSettlementDate >= swap.settlementPeriod) {
      settleSwap(swapId);
    }

    swapManager.markClosed(swapId);
    emit SwapClosed(swapId);
  }

  // ── Multi-swap netting ────────────────────────────────────────────────

  /// @notice Settle multiple swaps between the SAME two parties in a single net payment.
  ///
  ///         Instead of N separate transfers (each revealing one payment), all
  ///         payments are accumulated as encrypted sums and only the NET difference
  ///         moves.  This eliminates information leakage from individual swap sizes.
  ///
  ///         FHE core:
  ///           For each swap i:
  ///             p1Pays_i = FHE.gt(fixedRate_i, floating)           → ebool
  ///             payment_i = FHE.mul(notional_i, |fixedRate_i − floating|) → euint64
  ///             totalP1Pays += select(p1Pays_i, payment_i, 0)
  ///             totalP2Pays += select(p1Pays_i, 0, payment_i)
  ///           net direction = FHE.ge(totalP1Pays, totalP2Pays)     → ebool
  ///           net payment   = |totalP1Pays − totalP2Pays|          → euint64
  ///           → single directional settlement
  ///
  ///         All swapIds must be ACTIVE, settlement-due, and between the same
  ///         party1 / party2 (in the same order).
  function settleNetted(uint256[] calldata swapIds) external {
    require(swapIds.length >= 2, "Need >=2 swaps to net");

    SwapManager.InterestRateSwap memory first = swapManager.getSwap(swapIds[0]);
    require(first.status == SwapManager.SwapStatus.ACTIVE, "First swap not active");
    require(
      block.timestamp - first.lastSettlementDate >= first.settlementPeriod,
      "First swap period not elapsed"
    );

    address party1 = first.party1;
    address party2 = first.party2;

    uint256 floatingRate = rateOracle.getCurrentRate();
    euint64 encFloating  = FHE.asEuint64(uint64(floatingRate));

    euint64 totalP1Pays = FHE.asEuint64(0);
    euint64 totalP2Pays = FHE.asEuint64(0);

    for (uint256 i = 0; i < swapIds.length; i++) {
      SwapManager.InterestRateSwap memory swap = swapManager.getSwap(swapIds[i]);
      require(swap.status == SwapManager.SwapStatus.ACTIVE, "Swap not active");
      require(
        block.timestamp - swap.lastSettlementDate >= swap.settlementPeriod,
        "Settlement period not elapsed"
      );
      require(swap.party1 == party1 && swap.party2 == party2, "Party mismatch");

      euint64 notional = swapManager.getSwapNotional(swapIds[i]);
      ebool   p1Pays   = FHE.gt(swap.fixedRate, encFloating);
      euint64 netRate  = FHE.select(
        p1Pays,
        FHE.sub(swap.fixedRate, encFloating),
        FHE.sub(encFloating, swap.fixedRate)
      );
      euint64 payment = FHE.mul(notional, netRate);

      totalP1Pays = FHE.add(totalP1Pays, FHE.select(p1Pays, payment, FHE.asEuint64(0)));
      totalP2Pays = FHE.add(totalP2Pays, FHE.select(p1Pays, FHE.asEuint64(0), payment));

      swapManager.updateAfterSettlement(swapIds[i]);
    }

    // Net: only the difference between the two sides moves.
    ebool   netP1Pays  = FHE.ge(totalP1Pays, totalP2Pays);
    euint64 netPayment = FHE.select(
      netP1Pays,
      FHE.sub(totalP1Pays, totalP2Pays),
      FHE.sub(totalP2Pays, totalP1Pays)
    );

    FHE.allowThis(netP1Pays);
    FHE.allow(netP1Pays, address(settlementEngine));
    FHE.allowThis(netPayment);
    FHE.allow(netPayment, address(settlementEngine));

    settlementEngine.transferPaymentDirectional(party1, party2, netPayment, netP1Pays);

    emit SwapsNetted(party1, party2, swapIds.length);
  }
}
