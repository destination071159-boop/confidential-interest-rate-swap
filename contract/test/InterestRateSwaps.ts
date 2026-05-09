/**
 * test/InterestRateSwaps.ts
 *
 * Test suite for the confidential Interest Rate Swap protocol.
 *
 * Key fhevm patterns used
 * ───────────────────────
 *  • fhevm.createEncryptedInput(contractAddr, callerAddr) — build an off-chain
 *    encrypted value that can be verified on-chain by a specific contract.
 *  • .add64(amount).encrypt()  — encrypt a uint64 value.
 *  • handles[0] / inputProof   — the on-chain handle and ZK proof.
 *  • fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer)
 *    — decrypt an encrypted value client-side (only works for ACL-permitted signers).
 *
 * Unit conventions (mirrors contract comments)
 * ─────────────────────────────────────────────
 *  • Token amounts  : micro-USDC (6 dec).  1 USDC = 1_000_000.
 *  • Notional       : micro-USDC.
 *  • Fixed rate     : bps per 30-day period.  50 bps ≈ 6 % annual.
 *  • Floating rate  : same unit (set via RateOracle.setRate).
 *  • Internal coll. : micro-USDC × BPS_SCALE (10 000) — divide by 10 000 after decrypt.
 *
 * Settlement arithmetic (verified in test)
 * ─────────────────────────────────────────
 *  paymentScaled  = notional × netRateBps
 *  actual_payment = paymentScaled / BPS_SCALE  (done off-chain after decrypt)
 *
 * Example:
 *   notional   = 1_000_000 micro-USDC  (= 1 USDC)
 *   fixedRate  = 50 bps,  floatingRate = 30 bps  → party1 pays
 *   netRate    = 20 bps
 *   paymentScaled = 1_000_000 × 20 = 20_000_000
 *   actual_payment = 20_000_000 / 10_000 = 2_000 micro-USDC  (= 0.002 USDC)
 */

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

// ── Constants ────────────────────────────────────────────────────────────────

const MICRO = 1_000_000n; // 1 USDC in micro-USDC
const BPS_SCALE = 10_000n; // SettlementEngine internal scaling factor
const USER_MINT = 100n * MICRO; // 100 USDC per test wallet
const DEPOSIT_AMOUNT = 50n * MICRO; // 50 USDC deposited as collateral
const NOTIONAL = 100n * MICRO; // 100 USDC notional
const FIXED_RATE = 50n; // 50 bps per 30-day period  (~6 % annual)
const FLOATING_RATE_LOW = 30n; // 30 bps — party1 (fixed) pays  net 20 bps
const FLOATING_RATE_HIGH = 70n; // 70 bps — party2 (floating) pays net 20 bps

// ── Types ─────────────────────────────────────────────────────────────────────

type Signers = {
  deployer: HardhatEthersSigner;
  party1: HardhatEthersSigner;
  party2: HardhatEthersSigner;
  keeper: HardhatEthersSigner;
};

interface Contracts {
  token: any;
  rateOracle: any;
  swapManager: any;
  settlementEngine: any;
  swapPool: any;
  protocol: any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deploy the full IRS protocol stack.
 * Authorisation wiring mirrors the production deployment script.
 */
async function deployAll(deployer: HardhatEthersSigner): Promise<Contracts> {
  const token = await (
    await ethers.getContractFactory("MockConfidentialToken", deployer)
  ).deploy();

  const rateOracle = await (
    await ethers.getContractFactory("RateOracle", deployer)
  ).deploy();

  const swapManager = await (
    await ethers.getContractFactory("SwapManager", deployer)
  ).deploy();

  const settlementEngine = await (
    await ethers.getContractFactory("SettlementEngine", deployer)
  ).deploy(await token.getAddress());

  const swapPool = await (
    await ethers.getContractFactory("SwapPool", deployer)
  ).deploy(
    await swapManager.getAddress(),
    await rateOracle.getAddress(),
    await settlementEngine.getAddress(),
  );

  const protocol = await (
    await ethers.getContractFactory("InterestRateSwapProtocol", deployer)
  ).deploy(
    await swapManager.getAddress(),
    await swapPool.getAddress(),
    await rateOracle.getAddress(),
    await settlementEngine.getAddress(),
  );

  // ── Authorise sub-contracts ────────────────────────────────────────────
  // Protocol → SwapManager (createSwap)
  await swapManager.authorise(await protocol.getAddress());
  // SwapPool → SwapManager (updateAfterSettlement, markClosed, getSwapNotional)
  await swapManager.authorise(await swapPool.getAddress());
  // SwapPool → SettlementEngine (transferPayment)
  await settlementEngine.authorise(await swapPool.getAddress());

  return { token, rateOracle, swapManager, settlementEngine, swapPool, protocol };
}

/**
 * Mint tokens and deposit collateral for a user.
 * Mirrors the helper in Collateral.ts exactly.
 */
async function mintAndDeposit(
  c: Contracts,
  user: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const tokenAddr = await c.token.getAddress();
  const settlementAddr = await c.settlementEngine.getAddress();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400 * 365);

  // 1. Mint plain tokens to user.
  await c.token.connect(user).mint(user.address, amount);

  // 2. Approve SettlementEngine as operator so it can call confidentialTransferFrom.
  await c.token.connect(user).setOperator(settlementAddr, expiry);

  // 3. Create encrypted input: (tokenAddr, settlementEngineAddr) — the pair that
  //    token's InputVerifier will validate when msg.sender == settlementEngine.
  const input = fhevm.createEncryptedInput(tokenAddr, settlementAddr);
  input.add64(amount);
  const { handles, inputProof } = await input.encrypt();

  // 4. Call deposit directly on SettlementEngine (not via Protocol),
  //    so that msg.sender = user and collateral is stored under user's address.
  await c.settlementEngine.connect(user).deposit(handles[0], inputProof);
}

/**
 * Decrypt a user's internal collateral balance (BPS_SCALE × micro-USDC),
 * then return the actual micro-USDC value.
 */
async function getCollateralMicro(
  c: Contracts,
  user: HardhatEthersSigner,
): Promise<bigint> {
  const settlementAddr = await c.settlementEngine.getAddress();
  const handle = await c.settlementEngine.connect(user).getMyCollateral();
  const scaled = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    handle,
    settlementAddr,
    user,
  );
  // Divide by BPS_SCALE off-chain to get micro-USDC.
  return BigInt(scaled) / BPS_SCALE;
}

/**
 * Initiate a swap with BOTH notional and fixedRate encrypted in a single input batch.
 * handles[0] = notional, handles[1] = fixedRate
 * The protocol's FHE.fromExternal() verifies both with the same inputProof.
 */
async function initiateSwap(
  c: Contracts,
  party1: HardhatEthersSigner,
  party2: HardhatEthersSigner,
  notional: bigint,
  fixedRate: bigint,
  termDays: number,
): Promise<bigint> {
  const protocolAddr = await c.protocol.getAddress();

  // Pack both encrypted values into one batch — same pattern as LimitOrderBook.
  const input = fhevm.createEncryptedInput(protocolAddr, party1.address);
  input.add64(notional);   // handles[0]
  input.add64(fixedRate);  // handles[1]
  const { handles, inputProof } = await input.encrypt();

  const tx = await c.protocol
    .connect(party1)
    .initiateSwap(party2.address, handles[0], handles[1], inputProof, termDays);
  const receipt = await tx.wait();

  // Parse the SwapInitiated event to get swapId.
  const iface = c.protocol.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "SwapInitiated") {
        return parsed.args.swapId as bigint;
      }
    } catch {
      // ignore unrelated logs
    }
  }
  throw new Error("SwapInitiated event not found");
}

/** Advance blockchain time by `seconds` and mine a block. */
async function advanceTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("Interest Rate Swaps — confidential protocol (mock FHE)", function () {
  let signers: Signers;
  let c: Contracts;

  before(async function () {
    const all = await ethers.getSigners();
    signers = {
      deployer: all[0],
      party1: all[1],
      party2: all[2],
      keeper: all[3],
    };
  });

  beforeEach(async function () {
    // Skip on Sepolia — these tests require the local FHEVM mock.
    if (!fhevm.isMock) {
      this.skip();
    }
    c = await deployAll(signers.deployer);
  });

  // ── Deployment ────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("wires all sub-contracts correctly", async function () {
      expect(await c.protocol.swapManager()).to.equal(
        await c.swapManager.getAddress(),
      );
      expect(await c.protocol.swapPool()).to.equal(
        await c.swapPool.getAddress(),
      );
      expect(await c.protocol.rateOracle()).to.equal(
        await c.rateOracle.getAddress(),
      );
      expect(await c.protocol.settlementEngine()).to.equal(
        await c.settlementEngine.getAddress(),
      );
    });

    it("oracle starts at 41 bps per period (~5 % annual)", async function () {
      expect(await c.rateOracle.getCurrentRate()).to.equal(41n);
    });
  });

  // ── Oracle ────────────────────────────────────────────────────────────

  describe("RateOracle", function () {
    it("owner can update the floating rate", async function () {
      await c.rateOracle.setRate(FLOATING_RATE_LOW);
      expect(await c.rateOracle.getCurrentRate()).to.equal(FLOATING_RATE_LOW);
    });

    it("rejects rates above the ceiling (1 000 bps)", async function () {
      await expect(c.rateOracle.setRate(1_001n)).to.be.revertedWith(
        "Rate above ceiling",
      );
    });

    it("protocol exposes the current floating rate", async function () {
      await c.rateOracle.setRate(FLOATING_RATE_LOW);
      expect(await c.protocol.getCurrentFloatingRate()).to.equal(
        FLOATING_RATE_LOW,
      );
    });
  });

  // ── Collateral deposit / withdraw ─────────────────────────────────────

  describe("SettlementEngine — collateral", function () {
    it("party1 can deposit and read encrypted balance", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      const balanceMicro = await getCollateralMicro(c, signers.party1);
      expect(balanceMicro).to.equal(DEPOSIT_AMOUNT);
    });

    it("deposits from two parties are independent", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT * 2n);

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT);
      expect(bal2).to.equal(DEPOSIT_AMOUNT * 2n);
    });

    it("withdraw reduces balance and returns tokens", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);

      const settlementAddr = await c.settlementEngine.getAddress();
      const withdrawAmt = 10n * MICRO;

      const input = fhevm.createEncryptedInput(
        settlementAddr,
        signers.party1.address,
      );
      input.add64(withdrawAmt);
      const { handles, inputProof } = await input.encrypt();

      await c.settlementEngine
        .connect(signers.party1)
        .withdraw(handles[0], inputProof);

      const balAfter = await getCollateralMicro(c, signers.party1);
      expect(balAfter).to.equal(DEPOSIT_AMOUNT - withdrawAmt);
    });
  });

  // ── Swap initiation ───────────────────────────────────────────────────

  describe("InterestRateSwapProtocol — initiateSwap", function () {
    it("emits SwapInitiated and stores public metadata", async function () {
      const protocolAddr = await c.protocol.getAddress();
      const input = fhevm.createEncryptedInput(
        protocolAddr,
        signers.party1.address,
      );
      input.add64(NOTIONAL);     // handles[0]
      input.add64(FIXED_RATE);   // handles[1]
      const { handles, inputProof } = await input.encrypt();

      await expect(
        c.protocol
          .connect(signers.party1)
          .initiateSwap(
            signers.party2.address,
            handles[0],
            handles[1],
            inputProof,
            360,
          ),
      )
        .to.emit(c.protocol, "SwapInitiated")
        .withArgs(1n, signers.party1.address, signers.party2.address, 360n);
    });

    it("rejects self-swap", async function () {
      const protocolAddr = await c.protocol.getAddress();
      const input = fhevm.createEncryptedInput(
        protocolAddr,
        signers.party1.address,
      );
      input.add64(NOTIONAL);
      input.add64(FIXED_RATE);
      const { handles, inputProof } = await input.encrypt();

      await expect(
        c.protocol
          .connect(signers.party1)
          .initiateSwap(
            signers.party1.address,
            handles[0],
            handles[1],
            inputProof,
            360,
          ),
      ).to.be.revertedWith("Self-swap not allowed");
    });

    it("rejects zero term days", async function () {
      const protocolAddr = await c.protocol.getAddress();
      const input = fhevm.createEncryptedInput(
        protocolAddr,
        signers.party1.address,
      );
      input.add64(NOTIONAL);
      input.add64(FIXED_RATE);
      const { handles, inputProof } = await input.encrypt();

      await expect(
        c.protocol
          .connect(signers.party1)
          .initiateSwap(
            signers.party2.address,
            handles[0],
            handles[1],
            inputProof,
            0, // zero term — should revert
          ),
      ).to.be.revertedWith("Invalid term");
    });

    it("party1 can decrypt the encrypted notional", async function () {
      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      const smAddr = await c.swapManager.getAddress();
      const notionalHandle = await c.swapManager.getSwapNotional(swapId);
      const decrypted = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        notionalHandle,
        smAddr,
        signers.party1,
      );
      expect(BigInt(decrypted)).to.equal(NOTIONAL);
    });

    it("party1 can decrypt the encrypted fixed rate", async function () {
      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      const smAddr = await c.swapManager.getAddress();
      const fixedRateHandle = await c.swapManager.getSwapFixedRate(swapId);
      const decrypted = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        fixedRateHandle,
        smAddr,
        signers.party1,
      );
      expect(BigInt(decrypted)).to.equal(FIXED_RATE);
    });
  });

  // ── Settlement — fixed payer owes net ─────────────────────────────────

  describe("Settlement (fixed rate > floating rate — party1 pays)", function () {
    it("settleIfDue is a no-op before the period elapses", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW); // fixed 50 > floating 30

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );

      // Do NOT advance time — settlement should not be due.
      await c.protocol.connect(signers.keeper).settleIfDue(swapId);

      // Balances unchanged.
      const bal1 = await getCollateralMicro(c, signers.party1);
      expect(bal1).to.equal(DEPOSIT_AMOUNT);
    });

    it("settles after 30 days and transfers net payment", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW); // fixed 50 > floating 30  → party1 pays

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );

      // Advance 30 days.
      await advanceTime(30 * 24 * 60 * 60);

      expect(await c.swapPool.isSettlementDue(swapId)).to.be.true;

      await expect(
        c.protocol.connect(signers.keeper).settleIfDue(swapId),
      ).to.emit(c.swapPool, "SwapSettled");

      // ── Verify encrypted balance changes ──────────────────────────────
      // netRateBps = 50 − 30 = 20
      // paymentScaled = NOTIONAL × 20 = 100_000_000 × 20 = 2_000_000_000
      // actual_payment = 2_000_000_000 / 10_000 = 200_000 micro-USDC = 0.2 USDC
      const netRate = FIXED_RATE - FLOATING_RATE_LOW; // 20n
      const expectedPayment = (NOTIONAL * netRate) / BPS_SCALE; // 200_000n micro-USDC

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);

      expect(bal1).to.equal(DEPOSIT_AMOUNT - expectedPayment);
      expect(bal2).to.equal(DEPOSIT_AMOUNT + expectedPayment);
    });

    it("emits SwapSettled event after 30 days", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW);

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      await advanceTime(30 * 24 * 60 * 60);

      // Direction is hidden — only the swapId is emitted.
      await expect(c.protocol.connect(signers.keeper).settleIfDue(swapId))
        .to.emit(c.swapPool, "SwapSettled")
        .withArgs(swapId);
    });
  });

  // ── Settlement — floating payer owes net ──────────────────────────────

  describe("Settlement (floating rate > fixed rate — party2 pays)", function () {
    it("party2 pays when floating rate is higher", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_HIGH); // floating 70 > fixed 50 → party2 pays

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      await advanceTime(30 * 24 * 60 * 60);

      // Direction is hidden — event only carries swapId.
      await expect(c.protocol.connect(signers.keeper).settleIfDue(swapId))
        .to.emit(c.swapPool, "SwapSettled")
        .withArgs(swapId);

      const netRate = FLOATING_RATE_HIGH - FIXED_RATE; // 20n
      const expectedPayment = (NOTIONAL * netRate) / BPS_SCALE;

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT + expectedPayment);
      expect(bal2).to.equal(DEPOSIT_AMOUNT - expectedPayment);
    });
  });

  // ── No net payment when rates are equal ──────────────────────────────

  describe("Settlement (rates equal — no transfer)", function () {
    it("balances unchanged when netRateBps == 0", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      // Set floating == fixed so net = 0.
      await c.rateOracle.setRate(FIXED_RATE);

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      await advanceTime(30 * 24 * 60 * 60);
      await c.protocol.connect(signers.keeper).settleIfDue(swapId);

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT);
      expect(bal2).to.equal(DEPOSIT_AMOUNT);
    });
  });

  // ── Multiple settlement periods ────────────────────────────────────────

  describe("Multiple settlements over the swap term", function () {
    it("settles correctly over two consecutive 30-day periods", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW); // party1 pays each period

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );

      const netRate = FIXED_RATE - FLOATING_RATE_LOW;
      const paymentPerPeriod = (NOTIONAL * netRate) / BPS_SCALE;

      // Period 1.
      await advanceTime(30 * 24 * 60 * 60);
      await c.protocol.connect(signers.keeper).settleIfDue(swapId);

      // Period 2.
      await advanceTime(30 * 24 * 60 * 60);
      await c.protocol.connect(signers.keeper).settleIfDue(swapId);

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT - paymentPerPeriod * 2n);
      expect(bal2).to.equal(DEPOSIT_AMOUNT + paymentPerPeriod * 2n);
    });
  });

  // ── Swap status lifecycle ──────────────────────────────────────────────

  describe("Swap status transitions", function () {
    it("swap is ACTIVE after creation", async function () {
      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        30,
      );
      const [, , , status] = await c.protocol.getSwapStatus(swapId);
      expect(status).to.equal("ACTIVE");
    });

    it("swap becomes EXPIRED then CLOSED via closeAtMaturity", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW);

      // Create a 30-day swap.
      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        30,
      );

      // Advance past maturity.
      await advanceTime(31 * 24 * 60 * 60);

      await expect(
        c.protocol.connect(signers.keeper).closeAtMaturity(swapId),
      ).to.emit(c.swapPool, "SwapClosed");

      const [, , , status] = await c.protocol.getSwapStatus(swapId);
      expect(status).to.equal("CLOSED");
    });

    it("cannot settle a CLOSED swap", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW);

      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        30,
      );
      await advanceTime(31 * 24 * 60 * 60);
      await c.protocol.connect(signers.keeper).closeAtMaturity(swapId);

      // Attempting to settle a CLOSED swap should revert.
      await expect(
        c.swapPool.settleSwap(swapId),
      ).to.be.revertedWith("Swap not active");
    });
  });

  // ── SwapManager getSwapStatus view ────────────────────────────────────

  describe("getSwapStatus public view", function () {
    it("returns correct party addresses", async function () {
      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      const [party1, party2, , status] = await c.protocol.getSwapStatus(swapId);

      expect(party1).to.equal(signers.party1.address);
      expect(party2).to.equal(signers.party2.address);
      // fixedRate is encrypted — verify it separately via getSwapFixedRate + decrypt.
      expect(status).to.equal("ACTIVE");
    });
  });

  // ── Liquidation ───────────────────────────────────────────────────────

  describe("SettlementEngine — auto-liquidation", function () {
    it("seizes collateral when party is undercollateralised", async function () {
      const smallDeposit = 10n * MICRO; // 10 USDC
      const minCollateral = 20n * MICRO; // require 20 USDC

      await mintAndDeposit(c, signers.party1, smallDeposit);

      // Configure minimum collateral — 10 < 20, so party1 is undercollateralised.
      await c.settlementEngine
        .connect(signers.deployer)
        .setMinCollateral(minCollateral);

      // keeper triggers liquidation
      await expect(
        c.settlementEngine
          .connect(signers.keeper)
          .liquidate(signers.party1.address),
      )
        .to.emit(c.settlementEngine, "Liquidated")
        .withArgs(signers.party1.address);

      // party1's balance should now be 0 (seized).
      const balAfter = await getCollateralMicro(c, signers.party1);
      expect(balAfter).to.equal(0n);
    });

    it("does NOT seize when party is sufficiently collateralised", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT); // 50 USDC

      // Minimum is 20 USDC — party1 has 50, so solvent.
      await c.settlementEngine
        .connect(signers.deployer)
        .setMinCollateral(20n * MICRO);

      await c.settlementEngine.liquidate(signers.party1.address);

      // Balance unchanged (FHE.select picked the 0-seizure path).
      const bal = await getCollateralMicro(c, signers.party1);
      expect(bal).to.equal(DEPOSIT_AMOUNT);
    });

    it("reverts when liquidation is not configured", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      // minCollateralScaled == 0 (default)
      await expect(
        c.settlementEngine.liquidate(signers.party1.address),
      ).to.be.revertedWith("Liquidation not configured");
    });
  });

  // ── Multi-swap netting ────────────────────────────────────────────────

  describe("Multi-swap netting", function () {
    it("settles two swaps with one net transfer (party1 net payer)", async function () {
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      await c.rateOracle.setRate(FLOATING_RATE_LOW); // floating 30, fixed 50 → p1 net payer

      // Two swaps: notional NOTIONAL and NOTIONAL/2
      const swapId1 = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      const swapId2 = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL / 2n,
        FIXED_RATE,
        360,
      );

      await advanceTime(30 * 24 * 60 * 60);

      await expect(
        c.swapPool.settleNetted([swapId1, swapId2]),
      ).to.emit(c.swapPool, "SwapsNetted");

      // net = (NOTIONAL + NOTIONAL/2) × (FIXED_RATE − FLOATING_RATE_LOW) / BPS_SCALE
      const netRate = FIXED_RATE - FLOATING_RATE_LOW;
      const expectedNet =
        ((NOTIONAL + NOTIONAL / 2n) * netRate) / BPS_SCALE;

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT - expectedNet);
      expect(bal2).to.equal(DEPOSIT_AMOUNT + expectedNet);
    });

    it("nets opposing obligations and transfers only the difference", async function () {
      // Both swaps same notional but swap2 uses a lower fixed rate so p2 is a net payer.
      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);
      // floating = 50 (== FIXED_RATE) so swap1 nets 0; swap2 uses rate 70 → p2 pays 20
      await c.rateOracle.setRate(FIXED_RATE); // 50 bps

      const swapId1 = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE, // 50 == floating → net 0
        360,
      );
      const swapId2 = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        30n, // fixed 30 < floating 50 → p2 pays net 20
        360,
      );

      await advanceTime(30 * 24 * 60 * 60);
      await c.swapPool.settleNetted([swapId1, swapId2]);

      // swap1: net = 0.  swap2: p2 pays (50-30)×NOTIONAL/BPS_SCALE
      const expectedNet = ((FIXED_RATE - 30n) * NOTIONAL) / BPS_SCALE;
      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT + expectedNet);
      expect(bal2).to.equal(DEPOSIT_AMOUNT - expectedNet);
    });

    it("rejects netting with fewer than 2 swaps", async function () {
      const swapId = await initiateSwap(
        c,
        signers.party1,
        signers.party2,
        NOTIONAL,
        FIXED_RATE,
        360,
      );
      await advanceTime(30 * 24 * 60 * 60);
      await expect(
        c.swapPool.settleNetted([swapId]),
      ).to.be.revertedWith("Need >=2 swaps to net");
    });
  });

  // ── Swaption ──────────────────────────────────────────────────────────

  describe("SwaptionVault — confidential payer swaption", function () {
    let vault: any;

    beforeEach(async function () {
      vault = await (
        await ethers.getContractFactory("SwaptionVault", signers.deployer)
      ).deploy(
        await c.swapManager.getAddress(),
        await c.rateOracle.getAddress(),
        await c.swapPool.getAddress(),
      );
      // Authorise vault to call swapManager.createSwap
      await c.swapManager.authorise(await vault.getAddress());
    });

    it("writer can write and buyer can exercise an ITM swaption", async function () {
      const vaultAddr = await vault.getAddress();
      const STRIKE = 40n; // strike 40 bps
      const FLOATING_ITM = 50n; // floating 50 > 40 → ITM

      await c.rateOracle.setRate(FLOATING_ITM);

      const latestBlock = await ethers.provider.getBlock("latest");
      const expiry = latestBlock!.timestamp + 86_400 * 30;

      // party2 = writer, party1 = buyer
      const input = fhevm.createEncryptedInput(
        vaultAddr,
        signers.party2.address,
      );
      input.add64(STRIKE);   // handles[0] = strikeRate
      input.add64(NOTIONAL); // handles[1] = notional
      const { handles, inputProof } = await input.encrypt();

      await expect(
        vault
          .connect(signers.party2)
          .writeSwaption(
            signers.party1.address,
            handles[0],
            handles[1],
            inputProof,
            expiry,
            360,
          ),
      )
        .to.emit(vault, "SwaptionWritten")
        .withArgs(
          1n,
          signers.party2.address,
          signers.party1.address,
          BigInt(expiry),
        );

      // buyer exercises — floating (50) > strike (40) → ITM
      await expect(vault.connect(signers.party1).exerciseSwaption(1))
        .to.emit(vault, "SwaptionExercised")
        .withArgs(1n, 1n); // swaptionId=1, resulting swapId=1

      expect(await vault.isExercised(1)).to.be.true;
    });

    it("OTM exercise still creates a swap (zero notional, no cash flows)", async function () {
      const vaultAddr = await vault.getAddress();
      const STRIKE = 60n; // strike 60 bps
      const FLOATING_OTM = 40n; // floating 40 < 60 → OTM

      await c.rateOracle.setRate(FLOATING_OTM);

      await mintAndDeposit(c, signers.party1, DEPOSIT_AMOUNT);
      await mintAndDeposit(c, signers.party2, DEPOSIT_AMOUNT);

      const latestBlock = await ethers.provider.getBlock("latest");
      const expiry = latestBlock!.timestamp + 86_400 * 30;

      const input = fhevm.createEncryptedInput(
        vaultAddr,
        signers.party2.address,
      );
      input.add64(STRIKE);
      input.add64(NOTIONAL);
      const { handles, inputProof } = await input.encrypt();

      await vault
        .connect(signers.party2)
        .writeSwaption(
          signers.party1.address,
          handles[0],
          handles[1],
          inputProof,
          expiry,
          360,
        );

      // Exercise OTM — swap is created but effectiveNotional = 0.
      await expect(
        vault.connect(signers.party1).exerciseSwaption(1),
      ).to.emit(vault, "SwaptionExercised");

      // Advance 30 days and settle the (zero-notional) swap — balances unchanged.
      await advanceTime(30 * 24 * 60 * 60);
      const swapId = 1n;
      await c.protocol.connect(signers.keeper).settleIfDue(swapId);

      const bal1 = await getCollateralMicro(c, signers.party1);
      const bal2 = await getCollateralMicro(c, signers.party2);
      expect(bal1).to.equal(DEPOSIT_AMOUNT);
      expect(bal2).to.equal(DEPOSIT_AMOUNT);
    });

    it("non-buyer cannot exercise", async function () {
      const vaultAddr = await vault.getAddress();
      const latestBlock = await ethers.provider.getBlock("latest");
      const expiry = latestBlock!.timestamp + 86_400 * 30;

      const input = fhevm.createEncryptedInput(
        vaultAddr,
        signers.party2.address,
      );
      input.add64(40n);
      input.add64(NOTIONAL);
      const { handles, inputProof } = await input.encrypt();

      await vault
        .connect(signers.party2)
        .writeSwaption(
          signers.party1.address,
          handles[0],
          handles[1],
          inputProof,
          expiry,
          360,
        );

      await expect(
        vault.connect(signers.party2).exerciseSwaption(1),
      ).to.be.revertedWith("Not buyer");
    });

    it("cannot exercise an expired swaption", async function () {
      const vaultAddr = await vault.getAddress();
      // expiry = EVM now + 5 seconds: writeSwaption succeeds (+1 block),
      // but advanceTime(10) then moves past it.
      const latestBlock = await ethers.provider.getBlock("latest");
      const expiry = latestBlock!.timestamp + 5;

      const input = fhevm.createEncryptedInput(
        vaultAddr,
        signers.party2.address,
      );
      input.add64(40n);
      input.add64(NOTIONAL);
      const { handles, inputProof } = await input.encrypt();

      await vault
        .connect(signers.party2)
        .writeSwaption(
          signers.party1.address,
          handles[0],
          handles[1],
          inputProof,
          expiry,
          360,
        );

      // Advance past expiry.
      await advanceTime(10);

      await expect(
        vault.connect(signers.party1).exerciseSwaption(1),
      ).to.be.revertedWith("Swaption expired");
    });
  });
});
