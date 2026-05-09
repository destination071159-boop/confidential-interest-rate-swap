'use client';

import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useEncrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { SETTLEMENT_ENGINE_ADDRESS, SETTLEMENT_ENGINE_ABI, TOKEN_ADDRESS, TOKEN_ABI } from '@/lib/contracts';
import { DecryptCollateral } from './DecryptCollateral';
import { MintPanel } from './MintPanel';
import { shorten } from '@/lib/utils';

export function AccountSection() {
  const { address, isConnected } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const [depositAmt,  setDepositAmt]  = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [status,      setStatus]      = useState('');
  const [txHash,      setTxHash]      = useState<`0x${string}` | undefined>();
  const [busy,        setBusy]        = useState(false);

  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  // cUSDC wallet balance
  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address },
  });

  // collateral handle for decryption
  const { data: collateralHandle, refetch } = useReadContract({
    address: SETTLEMENT_ENGINE_ADDRESS,
    abi: SETTLEMENT_ENGINE_ABI,
    functionName: 'getMyCollateral',
    query: { enabled: isConnected },
  });

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected || !address) return;
    setBusy(true);
    setStatus('Encrypting deposit amount…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [{ value: BigInt(depositAmt), type: 'euint64' }],
        contractAddress: TOKEN_ADDRESS,
        userAddress: address,
      });
      const encAmount  = bytesToHex(enc.handles[0]!);
      const inputProof = bytesToHex(enc.inputProof);
      setStatus('Waiting for wallet confirmation…');
      const hash = await writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: 'confidentialTransferAndCall',
        args: [SETTLEMENT_ENGINE_ADDRESS, encAmount, inputProof, '0x'],
        gas: 15_000_000n,
      });
      setTxHash(hash);
      setStatus('Deposit submitted!');
      await refetch();
      await refetchBalance();
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected || !address) return;
    setBusy(true);
    setStatus('Encrypting withdraw amount…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [{ value: BigInt(withdrawAmt), type: 'euint64' }],
        contractAddress: SETTLEMENT_ENGINE_ADDRESS,
        userAddress: address,
      });
      const encAmount  = bytesToHex(enc.handles[0]!);
      const inputProof = bytesToHex(enc.inputProof);
      setStatus('Waiting for wallet confirmation…');
      const hash = await writeContractAsync({
        address: SETTLEMENT_ENGINE_ADDRESS,
        abi: SETTLEMENT_ENGINE_ABI,
        functionName: 'withdraw',
        args: [encAmount, inputProof],
        gas: 15_000_000n,
      });
      setTxHash(hash);
      setStatus('Withdrawal submitted!');
      await refetch();
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Wallet card */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Account</p>
        {isConnected && address ? (
          <>
            <div className="info-row">
              <span className="label">Address</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{shorten(address)}</span>
            </div>
            <div className="info-row">
              <span className="label">Network</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sepolia</span>
            </div>
            <div className="info-row">
              <span className="label">cUSDC Balance</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>
                {tokenBalance != null
                  ? `${(Number(tokenBalance) / 1_000_000).toFixed(2)} cUSDC`
                  : '—'}
              </span>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No wallet connected.</p>
        )}
      </div>

      {/* Mint test tokens */}
      <MintPanel onMinted={() => refetchBalance()} />

      {/* Collateral balance */}
      <div className="glass" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <p className="panel-title" style={{ marginBottom: 0 }}>Collateral</p>
          <span className="enc-badge">🔒 FHE</span>
        </div>

        {isConnected && collateralHandle != null ? (
          <DecryptCollateral handle={collateralHandle as `0x${string}`} />
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {isConnected ? 'Loading balance…' : 'Connect wallet to view.'}
          </p>
        )}
      </div>

      {/* Deposit */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Deposit Collateral</p>
        <form onSubmit={handleDeposit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>
              Amount (micro-USDC) <span className="enc-badge" style={{ marginLeft: 4 }}>🔒</span>
            </label>
            <input
              className="input"
              type="number"
              placeholder="1000000 = 1 USDC"
              value={depositAmt}
              onChange={e => setDepositAmt(e.target.value)}
              required min="1"
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || confirming || !isConnected}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {busy || confirming ? 'Processing…' : 'Deposit'}
          </button>
        </form>
      </div>

      {/* Withdraw */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Withdraw Collateral</p>
        <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>
              Amount (micro-USDC) <span className="enc-badge" style={{ marginLeft: 4 }}>🔒</span>
            </label>
            <input
              className="input"
              type="number"
              placeholder="500000"
              value={withdrawAmt}
              onChange={e => setWithdrawAmt(e.target.value)}
              required min="1"
            />
          </div>
          <button
            type="submit"
            className="btn-ghost"
            disabled={busy || confirming || !isConnected}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {busy || confirming ? 'Processing…' : 'Withdraw'}
          </button>
        </form>
      </div>

      {/* Status / tx link */}
      {status && (
        <p style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>{status}</p>
      )}
      {txHash && !confirming && (
        <a
          href={`https://sepolia.etherscan.io/tx/${txHash}`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', textDecoration: 'underline' }}
        >
          View on Etherscan ↗
        </a>
      )}
    </div>
  );
}
