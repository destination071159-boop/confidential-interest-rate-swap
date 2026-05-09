'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { PROTOCOL_ADDRESS, PROTOCOL_ABI, SWAP_POOL_ADDRESS, SWAP_POOL_ABI } from '@/lib/contracts';

export function SettleSection() {
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [swapId,   setSwapId]   = useState('');
  const [netIds,   setNetIds]   = useState('');  // comma-separated
  const [status,   setStatus]   = useState('');
  const [txHash,   setTxHash]   = useState<`0x${string}` | undefined>();
  const [busy,     setBusy]     = useState(false);
  const [mode,     setMode]     = useState<'single' | 'netted' | 'close'>('single');

  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  async function handleSettle(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected) return;
    setBusy(true);
    setStatus('Waiting for wallet confirmation…');
    try {
      let hash: `0x${string}`;
      if (mode === 'single') {
        hash = await writeContractAsync({
          address: PROTOCOL_ADDRESS,
          abi: PROTOCOL_ABI,
          functionName: 'settleIfDue',
          args: [BigInt(swapId)],
        });
      } else if (mode === 'netted') {
        const ids = netIds.split(',').map(s => BigInt(s.trim()));
        hash = await writeContractAsync({
          address: PROTOCOL_ADDRESS,
          abi: PROTOCOL_ABI,
          functionName: 'settleNetted',
          args: [ids],
        });
      } else {
        hash = await writeContractAsync({
          address: PROTOCOL_ADDRESS,
          abi: PROTOCOL_ABI,
          functionName: 'closeAtMaturity',
          args: [BigInt(swapId)],
        });
      }
      setTxHash(hash);
      setStatus('Settlement submitted!');
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="glass" style={{ padding: 28, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Connect wallet to settle swaps.</p>
      </div>
    );
  }

  return (
    <div className="glass" style={{ padding: 28, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <p className="panel-title" style={{ marginBottom: 0 }}>Settle</p>
        <span className="enc-badge">direction encrypted</span>
      </div>

      {/* Mode switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['single', 'netted', 'close'] as const).map(m => (
          <button
            key={m}
            className={mode === m ? 'btn-ghost' : 'btn-outline'}
            style={{ padding: '6px 14px', fontSize: 12, border: mode === m ? '1px solid rgba(255,255,255,0.3)' : undefined, color: mode === m ? 'var(--text)' : 'var(--text-dim)' }}
            onClick={() => setMode(m)}
          >
            {m === 'single' ? 'Single' : m === 'netted' ? 'Net Multiple' : 'Close at Maturity'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSettle} style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        {mode === 'netted' ? (
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>
              Swap IDs (comma-separated)
            </label>
            <input
              className="input"
              type="text"
              placeholder="1, 2, 3"
              value={netIds}
              onChange={e => setNetIds(e.target.value)}
              required
            />
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              Swaps must be between the same two parties. Net payment moves once — N transfers → 1.
            </p>
          </div>
        ) : (
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>Swap ID</label>
            <input
              className="input"
              type="number"
              placeholder="1"
              value={swapId}
              onChange={e => setSwapId(e.target.value)}
              required min="1"
            />
          </div>
        )}

        {/* Info */}
        <div style={{
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 11,
          color: 'var(--text-dim)',
          lineHeight: 1.7,
        }}>
          {mode === 'single' && 'Callable by anyone once the 30-day period elapses. Who paid and how much stays hidden.'}
          {mode === 'netted' && 'All swaps accumulate inside FHE. Only the net difference transfers — individual payments never leave the encrypted domain.'}
          {mode === 'close'  && 'Performs final settlement then closes the position. Callable by anyone after maturity.'}
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={busy || confirming}
          style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}
        >
          {busy || confirming ? 'Processing…' : mode === 'netted' ? 'Settle Netted' : mode === 'close' ? 'Close at Maturity' : 'Settle'}
        </button>

        {status && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>{status}</p>
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
      </form>
    </div>
  );
}
