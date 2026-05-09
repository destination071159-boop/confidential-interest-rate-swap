'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useEncrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { SETTLEMENT_ENGINE_ADDRESS, SETTLEMENT_ENGINE_ABI, TOKEN_ADDRESS, TOKEN_ABI } from '@/lib/contracts';

const PRESETS = [
  { label: '10 USDC',  value: 10_000_000 },
  { label: '50 USDC',  value: 50_000_000 },
  { label: '100 USDC', value: 100_000_000 },
];

interface Props {
  onDeposited?: () => void;
  onWithdrawn?: () => void;
}

export function CollateralSidebar({ onDeposited, onWithdrawn }: Props) {
  const { address, isConnected } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const [depositAmt,  setDepositAmt]  = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [status,      setStatus]      = useState('');
  const [txHash,      setTxHash]      = useState<`0x${string}` | undefined>();
  const [busy,        setBusy]        = useState(false);

  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

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
      onDeposited?.();
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
      onWithdrawn?.();
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Deposit */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Deposit Collateral</p>
        <form onSubmit={handleDeposit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Presets */}
          <div style={{ display: 'flex', gap: 6 }}>
            {PRESETS.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => setDepositAmt(String(p.value))}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: 11,
                  background: depositAmt === String(p.value) ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${depositAmt === String(p.value) ? 'var(--border-strong)' : 'var(--border)'}`,
                  borderRadius: 6,
                  color: depositAmt === String(p.value) ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
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
            {depositAmt && <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>= {(Number(depositAmt) / 1_000_000).toFixed(2)} USDC</p>}
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || confirming || !isConnected}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {busy || confirming ? 'Processing…' : `Deposit${depositAmt ? ` ${(Number(depositAmt) / 1_000_000).toFixed(2)} USDC` : ''}`}
          </button>
        </form>
      </div>

      {/* Withdraw */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Withdraw Collateral</p>
        <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Presets */}
          <div style={{ display: 'flex', gap: 6 }}>
            {PRESETS.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => setWithdrawAmt(String(p.value))}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: 11,
                  background: withdrawAmt === String(p.value) ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${withdrawAmt === String(p.value) ? 'var(--border-strong)' : 'var(--border)'}`,
                  borderRadius: 6,
                  color: withdrawAmt === String(p.value) ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>
              Amount (micro-USDC) <span className="enc-badge" style={{ marginLeft: 4 }}>🔒</span>
            </label>
            <input
              className="input"
              type="number"
              placeholder="1000000 = 1 USDC"
              value={withdrawAmt}
              onChange={e => setWithdrawAmt(e.target.value)}
              required min="1"
            />
            {withdrawAmt && <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>= {(Number(withdrawAmt) / 1_000_000).toFixed(2)} USDC</p>}
          </div>
          <button
            type="submit"
            className="btn-ghost"
            disabled={busy || confirming || !isConnected}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {busy || confirming ? 'Processing…' : `Withdraw${withdrawAmt ? ` ${(Number(withdrawAmt) / 1_000_000).toFixed(2)} USDC` : ''}`}
          </button>
        </form>
      </div>

      {/* Status */}
      {status && (
        <p style={{ fontSize: 11, color: status.startsWith('Error') ? '#ff6b6b' : 'var(--text-dim)', textAlign: 'center' }}>
          {status}
        </p>
      )}
      {txHash && !confirming && (
        <a
          href={`https://sepolia.etherscan.io/tx/${txHash}`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', textDecoration: 'underline', display: 'block' }}
        >
          View on Etherscan ↗
        </a>
      )}
    </div>
  );
}
