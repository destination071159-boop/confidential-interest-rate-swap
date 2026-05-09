/**
 * deploy/deploy_irs.ts
 *
 * Deploys the full Interest Rate Swap protocol stack in dependency order:
 *   1. MockConfidentialToken (ERC-7984) — test/devnet only; replace with real token on mainnet
 *   2. RateOracle
 *   3. SwapManager
 *   4. SettlementEngine
 *   5. SwapPool
 *   6. InterestRateSwapProtocol
 *
 * Then wires authorisation:
 *   • Protocol  → SwapManager   (createSwap)
 *   • SwapPool  → SwapManager   (updateAfterSettlement, markClosed, getSwapNotional/FixedRate)
 *   • SwapPool  → SettlementEngine (transferPaymentDirectional)
 *
 * Usage
 * ─────
 *   npx hardhat deploy --network hardhat   # local mock FHE
 *   npx hardhat deploy --network sepolia   # Sepolia testnet
 *   npx hardhat deploy --tags irs          # only this script
 */

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy, execute, get } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log(`\nDeploying IRS protocol to network: ${network.name}`);
  console.log(`Deployer: ${deployer}\n`);

  // ── 1. ERC-7984 token ───────────────────────────────────────────────────
  // On production, point to an already-deployed ConfidentialUSDC address and
  // skip this deploy step.
  const token = await deploy("MockConfidentialToken", {
    from: deployer,
    log: true,
    autoMine: true,
  });

  // ── 2. RateOracle ────────────────────────────────────────────────────────
  const rateOracle = await deploy("RateOracle", {
    from: deployer,
    log: true,
    autoMine: true,
    contract: "contracts/InterestRateSwaps/RateOracle.sol:RateOracle",
  });

  // ── 3. SwapManager ───────────────────────────────────────────────────────
  const swapManager = await deploy("SwapManager", {
    from: deployer,
    log: true,
    autoMine: true,
    contract: "contracts/InterestRateSwaps/SwapManager.sol:SwapManager",
  });

  // ── 4. SettlementEngine ──────────────────────────────────────────────────
  const settlementEngine = await deploy("SettlementEngine", {
    from: deployer,
    args: [token.address],
    log: true,
    autoMine: true,
    contract: "contracts/InterestRateSwaps/SettlementEngine.sol:SettlementEngine",
  });

  // ── 5. SwapPool ──────────────────────────────────────────────────────────
  const swapPool = await deploy("SwapPool", {
    from: deployer,
    args: [swapManager.address, rateOracle.address, settlementEngine.address],
    log: true,
    autoMine: true,
    contract: "contracts/InterestRateSwaps/SwapPool.sol:SwapPool",
  });

  // ── 6. InterestRateSwapProtocol ──────────────────────────────────────────
  const protocol = await deploy("InterestRateSwapProtocol", {
    from: deployer,
    args: [
      swapManager.address,
      swapPool.address,
      rateOracle.address,
      settlementEngine.address,
    ],
    log: true,
    autoMine: true,
    contract:
      "contracts/InterestRateSwaps/InterestRateSwapProtocol.sol:InterestRateSwapProtocol",
  });

  // ── Authorisation wiring ─────────────────────────────────────────────────
  console.log("\nWiring authorisations...");

  // Protocol → SwapManager
  await execute(
    "SwapManager",
    { from: deployer, log: true },
    "authorise",
    protocol.address,
  );

  // SwapPool → SwapManager
  await execute(
    "SwapManager",
    { from: deployer, log: true },
    "authorise",
    swapPool.address,
  );

  // SwapPool → SettlementEngine
  await execute(
    "SettlementEngine",
    { from: deployer, log: true },
    "authorise",
    swapPool.address,
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n── Deployment summary ──────────────────────────────────");
  console.log(`MockConfidentialToken  : ${token.address}`);
  console.log(`RateOracle             : ${rateOracle.address}`);
  console.log(`SwapManager            : ${swapManager.address}`);
  console.log(`SettlementEngine       : ${settlementEngine.address}`);
  console.log(`SwapPool               : ${swapPool.address}`);
  console.log(`InterestRateSwapProtocol: ${protocol.address}`);
  console.log("────────────────────────────────────────────────────────");

  console.log("\nPrivacy guarantees after deployment:");
  console.log("  ✓ Notional    — encrypted at initiateSwap (euint64)");
  console.log("  ✓ Fixed rate  — encrypted at initiateSwap (euint64)");
  console.log("  ✓ Payment dir — FHE.gt result, never revealed on-chain (ebool)");
  console.log("  ✓ Amount paid — FHE.mul(encrypted, encrypted), never revealed (euint64)");
};

func.tags = ["irs", "all"];
func.dependencies = [];

export default func;
