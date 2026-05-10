# Confidential Interest Rate Swap (IRS)

A fully on-chain interest rate swap protocol where every sensitive financial parameter — notional amount, agreed rate, payment direction, and amount paid — is encrypted using Fully Homomorphic Encryption (FHE) via [fhEVM](https://github.com/zama-ai/fhevm) by Zama.

## Demo

[![Demo Video](https://img.youtube.com/vi/3KByLzLIFFg/maxresdefault.jpg)](https://youtu.be/3KByLzLIFFg?si=s8CvHpRTG6s5BOFQ)

---

## What is an Interest Rate Swap?

An **Interest Rate Swap (IRS)** is a bilateral contract where two parties exchange interest payments on a notional principal:

- **Party A (fixed-rate payer):** agrees to pay a fixed rate (e.g. 5% per year) on a notional amount.
- **Party B (floating-rate payer):** agrees to pay a floating rate (e.g. SOFR, which fluctuates) on the same notional.

At each settlement period (typically monthly), only the **net difference** changes hands — not the full gross payments. For example, if fixed = 5% and floating = 3%, Party A pays 2% of the notional to Party B.

**Why use an IRS?**
- Hedge against rising or falling interest rates
- Speculate on rate movements without holding bonds
- Lock in a known borrowing cost

**The problem on public blockchains:** when you submit a swap on a transparent chain, everyone can see:
- Your notional (your exposure size)
- Your fixed rate (your view on where rates are going)
- Which direction you paid at settlement (your P&L situation)
- How much you paid (your exact cash flow)

This enables front-running, copy-trading, and market manipulation. This protocol fixes that with FHE.

---

## What Stays Private vs What Is Public

| Parameter | Visibility | Reason |
|---|---|---|
| Notional amount | **Private** (`euint64`) | Hiding size prevents whale detection and position front-running |
| Fixed rate agreed | **Private** (`euint64`) | Hiding your agreed rate hides your directional view on rates |
| Who pays at settlement | **Private** (`ebool`) | FHE comparison — result stored encrypted, never revealed on-chain |
| Amount paid at settlement | **Private** (`euint64`) | Product of private notional × public net rate; stays encrypted |
| Collateral balance | **Private** (`euint64`) | Hides total capital at risk; user decrypts via off-chain EIP-712 |
| Swaption strike rate | **Private** (`euint64`) | Hiding the strike prevents adversaries from trading around it |
| Swaption notional | **Private** (`euint64`) | Same as swap notional |
| ITM / OTM at exercise | **Private** | FHE.select zeroes out OTM notional — observers cannot distinguish |
| Swap counterparties | **Public** | Addresses are always on-chain |
| Term (days) | **Public** | Just defines duration; leaks no rate or size information |
| Settlement period elapsed | **Public** | Boolean trigger anyone can check |
| Swap status (active/expired) | **Public** | Lifecycle state for keeper automation |
| Floating rate (SOFR) | **Public** | Oracle rate is readable by everyone — it is the market rate |
| Swaption expiry | **Public** | Timestamp only; leaks no financial info |

---

## Contract Architecture

```
User / Frontend
      │
      │ initiateSwap(counterparty, encNotional, encFixedRate, proof, termDays)
      ▼
InterestRateSwapProtocol.sol       ← main entry point; users interact here only
      │
      ├─── SwapManager.sol          ← stores all swap structs and state
      │
      ├─── RateOracle.sol           ← provides the public floating rate (SOFR mock)
      │
      ├─── SwapPool.sol             ← FHE arithmetic: computes netRateBps × notional
      │                                triggers periodic settlements
      │
      ├─── SettlementEngine.sol     ← encrypted collateral vault; executes transfers
      │                                stores balances at BPS_SCALE for division-free math
      │
      └─── SwaptionVault.sol        ← option to enter a swap at an encrypted strike rate
```

### Contract Responsibilities

#### Deployed Addresses (Sepolia)

| Contract | Address |
|---|---|
| `InterestRateSwapProtocol` | [`0x75c03FbB00a7e20C26C79cCEd1B2E3c1641d0468`](https://sepolia.etherscan.io/address/0x75c03FbB00a7e20C26C79cCEd1B2E3c1641d0468) |
| `SettlementEngine` | [`0x714c05E71076CCa98BCf74D7fcd9241e7dBfa174`](https://sepolia.etherscan.io/address/0x714c05E71076CCa98BCf74D7fcd9241e7dBfa174) |
| `SwapManager` | [`0x2351fdF4E06ca29B8EC191591a96164314F91250`](https://sepolia.etherscan.io/address/0x2351fdF4E06ca29B8EC191591a96164314F91250) |
| `SwapPool` | [`0x2E0425d5b123ac53B3066d39349d579C2CC6d227`](https://sepolia.etherscan.io/address/0x2E0425d5b123ac53B3066d39349d579C2CC6d227) |
| `SwaptionVault` | [`0x20b9A53e183535cd5bA082335112D5D91B47DFa8`](https://sepolia.etherscan.io/address/0x20b9A53e183535cd5bA082335112D5D91B47DFa8) |
| `RateOracle` | [`0x440B998117C981b8896B7b6a4E374159efA7322f`](https://sepolia.etherscan.io/address/0x440B998117C981b8896B7b6a4E374159efA7322f) |
| `ConfidentialUSDC (cUSDC)` | [`0x3D3fF27d5D505DF9520f028e1253f1eE24125efe`](https://sepolia.etherscan.io/address/0x3D3fF27d5D505DF9520f028e1253f1eE24125efe) |

#### `InterestRateSwapProtocol.sol`
The single user-facing entry point. Accepts encrypted inputs, verifies input proofs via `FHE.fromExternal()`, and delegates to sub-contracts. Users never need to interact with sub-contracts directly.

#### `SwapManager.sol`
Stores each `InterestRateSwap` struct: notional (`euint64`), fixedRate (`euint64`), counterparties, startDate, endDate, lastSettlementDate, and status. Grants ACL permissions to both parties so each can decrypt their own ciphertext handles.

#### `RateOracle.sol`
Provides the current floating rate in basis points (e.g. `500` = 5.00%). Publicly readable — this is the market SOFR rate, not a secret. Any authorised address can update it; in production this would be a Chainlink-based feed.

#### `SwapPool.sol`
Executes the core FHE settlement math:
1. Reads `floatingRate` from the oracle (public)
2. Computes `netRateBps = |fixedRate_bps − floatingRate_bps|` — this is **public** because both inputs are public
3. Computes `paymentScaled = FHE.mul(notional, netRateBps)` — **encrypted**, because notional is private
4. Calls `SettlementEngine.transferPayment()` with the encrypted amount

#### `SettlementEngine.sol`
Encrypted collateral vault. Users deposit ERC-7984 confidential tokens; balances are stored scaled by `BPS_SCALE = 10_000` so that settlement deductions (`notional × netRateBps`) are unit-consistent without needing FHE division (which the library does not support). Users call `getMyCollateral()` and decrypt off-chain via `useUserDecrypt`.

#### `SwaptionVault.sol`
A payer swaption: the buyer holds the right to pay the encrypted `strikeRate` and receive floating. At exercise, `FHE.gt(currentFloating, strikeRate)` is computed; if OTM, `FHE.select` zeros the effective notional. A swap is always created — observers cannot distinguish an ITM exercise from an OTM lapse.

---

## Settlement Flow (Step by Step)

```
1. INITIATION
   ┌──────────────────────────────────────────────────────────┐
   │  User A (fixed payer) calls initiateSwap():              │
   │  • Encrypts notional + fixedRate off-chain (fhEVM SDK)   │
   │  • Submits: counterparty, encNotional, encFixedRate,     │
   │             inputProof, termDays                         │
   │  On-chain:                                               │
   │  • FHE.fromExternal() verifies proof → euint64 handles   │
   │  • SwapManager stores encrypted notional + fixedRate     │
   │  • ACL grants both parties access to their handles       │
   └──────────────────────────────────────────────────────────┘

2. PERIODIC SETTLEMENT (every 30 days)
   ┌──────────────────────────────────────────────────────────┐
   │  Anyone (keeper) calls settleSwap(swapId):               │
   │  • floatingRate = rateOracle.getCurrentRate()  [public]  │
   │  • netRateBps   = |fixedRate − floatingRate|   [public]  │
   │  • paymentScaled = FHE.mul(notional, netRateBps)[private]│
   │  • fixedPays = fixedRate > floatingRate         [public] │
   │  • SettlementEngine deducts from payer,         [FHE]    │
   │    credits receiver — both amounts stay private          │
   │  • lastSettlementDate updated                            │
   └──────────────────────────────────────────────────────────┘

3. NETTED SETTLEMENT (multiple swaps, same parties)
   ┌──────────────────────────────────────────────────────────┐
   │  settleNetted([swapId1, swapId2, ...]):                  │
   │  • Aggregates all payments in FHE before transferring    │
   │  • Single net transfer instead of N gross transfers      │
   │  • Reduces gas and minimises information leakage         │
   └──────────────────────────────────────────────────────────┘

4. CLOSE AT MATURITY
   ┌──────────────────────────────────────────────────────────┐
   │  closeAtMaturity(swapId):                                │
   │  • Runs final settlement if any period is outstanding    │
   │  • Marks swap EXPIRED                                    │
   │  • ACL handles remain — parties can still decrypt later  │
   └──────────────────────────────────────────────────────────┘
```

---

## FHE Encryption Flow (Frontend → Chain)

```
Browser (fhEVM SDK)
  │
  │  const enc = await encrypt.mutateAsync({
  │    values: [
  │      { value: notional,  type: 'euint64' },
  │      { value: fixedRate, type: 'euint64' },
  │    ],
  │    contractAddress: PROTOCOL_ADDRESS,
  │    userAddress: address,
  │  });
  │
  │  // enc.handles[0] = bytes32 handle for notional
  │  // enc.handles[1] = bytes32 handle for fixedRate
  │  // enc.inputProof = shared input proof for both values
  │
  ▼
InterestRateSwapProtocol.sol
  │
  │  euint64 notional  = FHE.fromExternal(encNotional,  inputProof);
  │  euint64 fixedRate = FHE.fromExternal(encFixedRate, inputProof);
  │  // Proof verified — ciphertexts now live on the FHE coprocessor
  │
  ▼
SwapManager.sol stores euint64 handles
  │
  ▼
SwapPool.sol computes FHE.mul(notional, netRateBps)  ← stays encrypted
  │
  ▼
SettlementEngine.sol debits/credits encrypted balances
```

**To read your own balance:**
```
Browser (fhEVM SDK)
  1. useIsAllowed({ contractAddresses: [SETTLEMENT_ENGINE_ADDRESS] })
  2. If not allowed → useAllow() signs an EIP-712 permit (one-time)
  3. useUserDecrypt({ handles: [{ handle, contractAddress }] })
     → relayer fetches re-encryption → returns plaintext only to you
```

No one else — not the relayer, not the contract, not Zama — learns your balance.

---

## Swaption Flow

```
1. Writer calls writeSwaption(buyer, encStrike, encNotional, proof, expiry, termDays)
   • strikeRate and notional stored as euint64 ciphertexts

2. Before expiry, buyer calls exerciseSwaption(swaptionId)
   • floatingRate = oracle.getCurrentRate()              [public]
   • itm = FHE.gt(floatingRate, strikeRate)             [private ebool]
   • effectiveNotional = FHE.select(itm, notional, 0)   [private euint64]
   • SwapManager.createSwap(effectiveNotional, strikeRate, ...)
   • If OTM: effectiveNotional = 0 → swap exists but produces zero cash flow
   • Observer cannot tell ITM from OTM — both emit SwapCreated

3. After expiry → lapseSwaption() marks it exercised with zero swap
```

---

## ERC-7984 — Confidential Token Standard

The collateral token (`cUSDC`) implements [ERC-7984](https://eips.ethereum.org/EIPS/eip-7984), a confidential ERC-20 extension where balances and transfer amounts are `euint64` ciphertexts on the FHE coprocessor. This is central to how deposits work:

- Instead of a standard `transfer`, the user calls `confidentialTransferAndCall(settlementEngine, encAmount, inputProof, "0x")` on the token contract.
- The token verifies the encrypted transfer, then calls back `onConfidentialTransferReceived` on `SettlementEngine` — atomically crediting the encrypted amount to the user's vault balance.
- At no point does any on-chain actor see a plaintext number. The vault receives, stores, and deducts a `euint64` throughout the entire lifecycle.

This is what makes collateral deposits trustless and private: the settlement vault never handles a plaintext amount, and the deposit and credit happen in a single atomic callback — no intermediate state, no approval race.

---

## Tech Stack

| Layer | Technology |
|---|---|
| FHE coprocessor | [fhEVM](https://github.com/zama-ai/fhevm) by Zama |
| Encrypted token | ERC-7984 (confidential ERC-20) |
| Smart contracts | Solidity 0.8.24, Hardhat + Foundry |
| Frontend | Next.js 15, React 19, TypeScript |
| Wallet/chain | wagmi v2, viem, Sepolia testnet |
| FHE SDK (UI) | `@zama-fhe/react-sdk` — `useEncrypt`, `useAllow`, `useUserDecrypt` |
| State | TanStack Query v5 |

---

## Running Locally

```bash
# Smart contracts
cd contract
npm install
npx hardhat compile
npx hardhat test          # 33/33 tests

# Frontend
cd frontend
npm install
cp .env.local.example .env.local   # fill in deployed addresses
npm run dev
```

Deploy to Sepolia:

```bash
cd contract
npx hardhat run deploy/deploy_irs.ts --network sepolia
```

Then copy the printed contract addresses into `frontend/.env.local`.
