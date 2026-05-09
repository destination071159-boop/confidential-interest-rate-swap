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

  const [mode,        setMode]        = useState<'deposit' | 'withdraw'>('deposit');
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

  const amt    = mode === 'deposit' ? depositAmt : withdrawAmt;
  const setAmt = mode === 'deposit' ? setDepositAmt : setWithdrawAmt;
  const usdcDisplay = amt ? (Number(amt) / 1_000_000).toFixed(2) : '';

  return (
    <div className="glass" style={{ padding: 28, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <p className="panel-title" style={{ marginBottom: 0 }}>Collateral</p>
        <span className="enc-badge">🔒 encrypted</span>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['deposit', 'withdraw'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setStatus(''); }}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 6,
              cursor: 'pointer',
              background: mode === m ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${mode === m ? 'rgba(255,255,255,0.3)' : 'var(--border)'}`,
              color: mode === m ? 'var(--text)' : 'var(--text-dim)',
            }}
          >
            {m === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
        ))}
      </div>

      <form
        onSubmit={mode === 'deposit' ? handleDeposit : handleWithdraw}
        style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}
      >
        {/* Presets */}
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => setAmt(String(p.value))}
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: 11,
                background: amt === String(p.value) ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${amt === String(p.value) ? 'var(--border-strong)' : 'var(--border)'}`,
                borderRadius: 6,
                color: amt === String(p.value) ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Amount input */}
        <div>
          <label className="label" style={{ display: 'block', marginBottom: 6 }}>
            Amount (micro-USDC) <span className="enc-badge" style={{ marginLeft: 4 }}>🔒</span>
          </label>
          <input
            className="input"
            type="number"
            placeholder="1000000 = 1 USDC"
            value={amt}
            onChange={e => setAmt(e.target.value)}
            required min="1"
          />
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, minHeight: 16 }}>{amt ? `= ${usdcDisplay} USDC` : ''}</p>
        </div>

        {/* Info box */}
        <div style={{
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 11,
          color: 'var(--text-dim)',
          lineHeight: 1.7,
          minHeight: 56,
        }}>
          {mode === 'deposit'
            ? 'Transfers cUSDC from your wallet into the encrypted vault. Amount is hidden on-chain.'
            : 'Withdraws cUSDC from the vault back to your wallet. Amount stays encrypted.'}
        </div>

        {/* Status */}
        {status && (
          <p style={{ fontSize: 11, color: status.startsWith('Error') ? '#ff6b6b' : 'var(--text-dim)', textAlign: 'center' }}>
            {status}
          </p>
        )}
        {txHash && !confirming && (
          <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', textDecoration: 'underline' }}>
            View on Etherscan ↗
          </a>
        )}

        {/* Submit — pinned to bottom */}
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || confirming || !isConnected}
          style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}
        >
          {busy || confirming ? 'Processing…' : mode === 'deposit'
            ? `Deposit${usdcDisplay ? ` ${usdcDisplay} USDC` : ''}`
            : `Withdraw${usdcDisplay ? ` ${usdcDisplay} USDC` : ''}`}
        </button>
      </form>
    </div>
  );
}
