// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";

/// @title SettlementEngine — Encrypted collateral vault for IRS settlement payments
///
/// @notice Users deposit ERC-7984 confidential tokens; balances are stored
///         internally at BPS_SCALE (× 10 000) so that settlement arithmetic
///         (notional_micro × netRateBps) maps to the same unit **without any
///         on-chain FHE division** (which the library does not support).
///
/// Unit model (internal)
/// ─────────────────────
///   • Token (external) : micro-USDC  (6 dec).  1 USDC = 1 000 000 units.
///   • Internal storage : micro-USDC × BPS_SCALE (10 000).
///
/// Why this scale?
///   SwapPool computes:  paymentScaled = notional_micro × netRateBps
///   Actual payment    = notional_micro × netRateBps / BPS_SCALE  (micro-USDC)
///   SettlementEngine stores: collateral_micro × BPS_SCALE
///   ∴ collateral_stored − paymentScaled  ≡  (actual_collateral − actual_payment) × BPS_SCALE
///   ⇒ no FHE division needed anywhere.
///
/// Deposit / Withdraw flow (same as Collateral.sol but scaled):
///   1. User sets this contract as operator on the ERC-7984 token.
///   2. User calls deposit(encAmount, proof) with (tokenAddr, thisAddr) encrypted input.
///   3. Internally stored as amount × BPS_SCALE.
///   4. Withdraw takes an encrypted micro-USDC request; deducts BPS_SCALE × amount internally;
///      transfers the un-scaled token amount back.
contract SettlementEngine is ZamaEthereumConfig, IERC7984Receiver {
  // ── Constants ─────────────────────────────────────────────────────────

  uint64 public constant BPS_SCALE = 10_000;

  // ── State ─────────────────────────────────────────────────────────────

  IERC7984 public immutable token;
  address public immutable owner;
  mapping(address => bool) public authorised;

  /// @dev Minimum collateral in micro-USDC × BPS_SCALE.  0 = liquidation disabled.
  ///      Set by owner via setMinCollateral(). Undercollateralised parties may be
  ///      liquidated by anyone — collateral is seized to the owner (insurance fund).
  uint64 public minCollateralScaled;

  /// @dev Stored as micro-USDC × BPS_SCALE.  Only the owner can decrypt via
  ///      getMyCollateral() + off-chain fhevm.userDecryptEuint.
  mapping(address => euint64) internal _collateral;

  // ── Events ────────────────────────────────────────────────────────────

  event Deposit(address indexed user, euint64 amountHandle);
  event Withdraw(address indexed user, euint64 amountHandle);
  event PaymentTransferred(address indexed from, address indexed to);
  /// @dev Emitted whenever liquidate() is called — does NOT reveal whether the party
  ///      was actually undercollateralised (FHE.select always runs both paths).
  event Liquidated(address indexed party);

  // ── Modifiers ─────────────────────────────────────────────────────────

  modifier onlyAuthorised() {
    require(authorised[msg.sender] || msg.sender == owner, "Not authorised");
    _;
  }

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(address tokenAddress) {
    token = IERC7984(tokenAddress);
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

  /// @notice Set the minimum collateral requirement (micro-USDC).  Set to 0 to disable.
  function setMinCollateral(uint64 minMicroUsdc) external {
    require(msg.sender == owner, "Not owner");
    // Safely scale: minMicroUsdc ≤ 1.8 × 10^15 before overflow (enough for any realistic value).
    minCollateralScaled = uint64(uint256(minMicroUsdc) * uint256(BPS_SCALE));
  }

  /// @notice Attempt to liquidate an undercollateralised party.
  ///
  ///         This is a FHE-safe operation: the code path is IDENTICAL whether or not
  ///         `party` is actually undercollateralised.  An on-chain observer only knows
  ///         that liquidate() was called — not whether seizure occurred or how much was
  ///         moved.  The Liquidated event reveals the party address only.
  ///
  ///         If solvent:     _collateral[party] unchanged, owner receives 0.
  ///         If insolvent:   _collateral[party] → 0,        owner receives the balance.
  ///
  ///         Callable by anyone (keeper-friendly).
  function liquidate(address party) external {
    require(minCollateralScaled > 0, "Liquidation not configured");
    require(party != owner, "Cannot liquidate insurance fund");

    euint64 minReq  = FHE.asEuint64(minCollateralScaled);
    ebool   solvent = FHE.ge(_collateral[party], minReq);

    // Seize full balance when NOT solvent; zero when solvent.
    euint64 seized = FHE.select(solvent, FHE.asEuint64(0), _collateral[party]);

    _collateral[party] = FHE.select(solvent, _collateral[party], FHE.asEuint64(0));
    _collateral[owner] = FHE.add(_collateral[owner], seized);

    FHE.allowThis(_collateral[party]);
    FHE.allow(_collateral[party], party);
    FHE.allowThis(_collateral[owner]);
    FHE.allow(_collateral[owner], owner);

    emit Liquidated(party);
  }

  // ── User-facing collateral management ─────────────────────────────────

  /// @notice ERC-7984 receiver callback — called by the token after a
  ///         confidentialTransferAndCall.
  ///         User calls token.confidentialTransferAndCall(settlementEngine, handle, proof, "")
  ///         directly; the token verifies the proof then calls this function
  ///         with the already-decoded euint64 — no contractAddress ambiguity.
  ///
  ///         The amount is scaled by BPS_SCALE before storage so that
  ///         settlement arithmetic (notional × netRateBps) is unit-consistent
  ///         without any FHE division.
  ///
  /// @param from    The sender of the confidential transfer (user).
  /// @param amount  Already-verified encrypted micro-USDC amount.
  function onConfidentialTransferReceived(
    address /* operator */,
    address from,
    euint64 amount,
    bytes calldata /* data */
  ) external override returns (ebool) {
    require(msg.sender == address(token), "SettlementEngine: only token");

    // Scale up by BPS_SCALE so settlement arithmetic is unit-consistent.
    euint64 scaledAmount = FHE.mul(amount, FHE.asEuint64(BPS_SCALE));

    if (FHE.isInitialized(_collateral[from])) {
      _collateral[from] = FHE.add(_collateral[from], scaledAmount);
    } else {
      _collateral[from] = scaledAmount;
    }

    FHE.allowThis(_collateral[from]);
    FHE.allow(_collateral[from], from);
    // Allow the user to decrypt the deposited amount from the event.
    FHE.allow(amount, from);

    emit Deposit(from, amount);

    // TOKEN needs transient ACL access to the returned ebool for its FHE.select refund logic.
    ebool success = FHE.asEbool(true);
    FHE.allowTransient(success, msg.sender);
    return success;
  }

  /// @notice Withdraw tokens from the vault.
  ///         If the balance covers the full request, exactly that amount is
  ///         returned; otherwise nothing is transferred (FHE.select zero path).
  ///         The on-chain payment amount is never revealed in plaintext.
  ///
  ///         Encrypted input must be created off-chain as:
  ///           fhevm.createEncryptedInput(settlementEngineAddr, userAddr)
  ///
  /// @param encAmount   Off-chain encrypted micro-USDC amount to withdraw.
  /// @param inputProof  Proof covering encAmount.
  function withdraw(externalEuint64 encAmount, bytes calldata inputProof) external {
    euint64 requested = FHE.fromExternal(encAmount, inputProof); // micro-USDC
    euint64 requestedScaled = FHE.mul(requested, FHE.asEuint64(BPS_SCALE));

    // Full-or-nothing: only withdraw if the scaled balance is sufficient.
    ebool sufficient = FHE.ge(_collateral[msg.sender], requestedScaled);
    euint64 deductScaled = FHE.select(sufficient, requestedScaled, FHE.asEuint64(0));
    euint64 transferOut = FHE.select(sufficient, requested, FHE.asEuint64(0));

    _collateral[msg.sender] = FHE.sub(_collateral[msg.sender], deductScaled);
    FHE.allowThis(_collateral[msg.sender]);
    FHE.allow(_collateral[msg.sender], msg.sender);

    // Transfer un-scaled token amount back to the user.
    FHE.allowTransient(transferOut, address(token));
    token.confidentialTransfer(msg.sender, transferOut);

    FHE.allow(transferOut, msg.sender);
    emit Withdraw(msg.sender, transferOut);
  }

  // ── Settlement transfer (called by SwapPool) ──────────────────────────

  /// @notice Transfer a BPS-scaled payment from `from` to `to`.
  ///         `paymentScaled` = notional_micro × netRateBps  (no division).
  ///         Clamped to `from`'s available balance — never reverts due to
  ///         insufficient funds; the swap just settles the maximum available.
  ///
  /// @param from           Payer address (fixed or floating party, determined by SwapPool).
  /// @param to             Receiver address.
  /// @param paymentScaled  FHE-computed BPS-scaled payment handle from SwapPool.
  function transferPayment(address from, address to, euint64 paymentScaled) external onlyAuthorised {
    // Ensure this contract can read the handle passed from SwapPool.
    FHE.allowThis(paymentScaled);

    // Clamp to available balance (avoids underflow without revealing amounts).
    euint64 actual = FHE.select(
      FHE.ge(_collateral[from], paymentScaled), 
      paymentScaled, 
      _collateral[from]
    );

    _collateral[from] = FHE.sub(_collateral[from], actual);
    _collateral[to] = FHE.add(_collateral[to], actual);

    FHE.allowThis(_collateral[from]);
    FHE.allow(_collateral[from], from);
    FHE.allowThis(_collateral[to]);
    FHE.allow(_collateral[to], to);

    emit PaymentTransferred(from, to);
  }

  // ── View helpers ──────────────────────────────────────────────────────

  /// @notice Returns the encrypted collateral handle for the caller.
  ///         Value is in micro-USDC × BPS_SCALE — divide by 10 000 off-chain
  ///         after decryption to get the actual micro-USDC balance.
  function getMyCollateral() external view returns (euint64) {
    return _collateral[msg.sender];
  }

  /// @notice Encrypted balance for an arbitrary user. Restricted to authorised callers.
  function getCollateral(address user) external view onlyAuthorised returns (euint64) {
    return _collateral[user];
  }

  // ── Directional settlement (called by SwapPool with encrypted direction) ──

  /// @notice Transfer payment with an **encrypted direction** (`party1Pays`).
  ///
  ///         This is the core privacy primitive of the IRS protocol:
  ///         - The payment AMOUNT is encrypted (product of encrypted notional × encrypted netRate).
  ///         - The payment DIRECTION is encrypted (FHE.gt result from SwapPool).
  ///         - On-chain observers see only that a settlement occurred — not who paid or how much.
  ///
  ///         Internally, two FHE.select calls ensure exactly one party is debited
  ///         and the other credited, all without revealing the ebool value:
  ///           party1Pays = true  → party1 balance ↓, party2 balance ↑
  ///           party1Pays = false → party2 balance ↓, party1 balance ↑
  ///
  ///         Both deductions are clamped to available balance — no revert on
  ///         insufficient collateral; the swap settles the maximum available.
  ///
  /// @param party1        First swap counterparty (fixed-rate side).
  /// @param party2        Second swap counterparty (floating-rate side).
  /// @param paymentScaled BPS-scaled encrypted payment: notional × netRateBps.
  /// @param party1Pays    Encrypted boolean from FHE.gt(fixedRate, floatingRate).
  function transferPaymentDirectional(
    address party1,
    address party2,
    euint64 paymentScaled,
    ebool party1Pays
  )
    external
    onlyAuthorised
  {
    FHE.allowThis(paymentScaled);
    FHE.allowThis(party1Pays);

    // Exactly one of these is non-zero (the other is encrypted 0).
    euint64 p1Deduct = FHE.select(party1Pays, paymentScaled, FHE.asEuint64(0));
    euint64 p2Deduct = FHE.select(party1Pays, FHE.asEuint64(0), paymentScaled);

    // Clamp each deduction to available balance — avoids FHE underflow.
    euint64 p1Actual = FHE.select(
      FHE.ge(_collateral[party1], p1Deduct), 
      p1Deduct, 
      _collateral[party1]
    );
    euint64 p2Actual = FHE.select(
      FHE.ge(_collateral[party2], p2Deduct), 
      p2Deduct, 
      _collateral[party2]
    );

    // Each party pays what it owes and receives what the other pays.
    _collateral[party1] = FHE.sub(FHE.add(_collateral[party1], p2Actual), p1Actual);
    _collateral[party2] = FHE.sub(FHE.add(_collateral[party2], p1Actual), p2Actual);

    FHE.allowThis(_collateral[party1]);
    FHE.allow(_collateral[party1], party1);
    FHE.allowThis(_collateral[party2]);
    FHE.allow(_collateral[party2], party2);

    emit PaymentTransferred(party1, party2);
  }
}
