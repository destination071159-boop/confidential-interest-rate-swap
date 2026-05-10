'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useEncrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { SWAPTION_VAULT_ADDRESS, SWAPTION_VAULT_ABI } from '@/lib/contracts';

export function SwaptionSection() {
  const { address, isConnected } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  // Write swaption form
  const [buyer,        setBuyer]        = useState('');
  const [strikeRate,   setStrikeRate]   = useState('');  // bps
  const [notional,     setNotional]     = useState('');  // micro-USDC
  const [expiry,       setExpiry]       = useState('');  // unix timestamp
  const [swapTermDays, setSwapTermDays] = useState('360');

  // Exercise form
  const [exerciseId, setExerciseId] = useState('');

  const [mode,   setMode]   = useState<'write' | 'exercise'>('write');
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy,   setBusy]   = useState(false);

  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  async function handleWrite(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected || !address) return;
    setBusy(true);
    setStatus('Encrypting strike rate & notional…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [
          { value: BigInt(strikeRate), type: 'euint64' },
          { value: BigInt(notional),   type: 'euint64' },
        ],
        contractAddress: SWAPTION_VAULT_ADDRESS,
        userAddress: address,
      });

      const encStrike  = bytesToHex(enc.handles[0]!);
      const encNotional = bytesToHex(enc.handles[1]!);
      const inputProof  = bytesToHex(enc.inputProof);

      setStatus('Waiting for wallet confirmation…');
      const hash = await writeContractAsync({
        address: SWAPTION_VAULT_ADDRESS,
        abi: SWAPTION_VAULT_ABI,
        functionName: 'writeSwaption',
        args: [
          buyer as `0x${string}`,
          encStrike,
          encNotional,
          inputProof,
          BigInt(expiry),
          BigInt(swapTermDays),
        ],
        gas: 15_000_000n,
      });
      setTxHash(hash);
      setStatus('Swaption written!');
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleExercise(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected) return;
    setBusy(true);
    setStatus('Waiting for wallet confirmation…');
    try {
      const hash = await writeContractAsync({
        address: SWAPTION_VAULT_ADDRESS,
        abi: SWAPTION_VAULT_ABI,
        functionName: 'exerciseSwaption',
        args: [BigInt(exerciseId)],
      });
      setTxHash(hash);
      setStatus('Swaption exercised — swap created!');
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="glass" style={{ padding: 28, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Connect wallet to use swaptionss.</p>
      </div>
    );
  }

  const expiryHint = expiry
    ? new Date(Number(expiry) * 1000).toLocaleString()
    : 'unix timestamp (seconds)';

  return (
    <div className="glass" style={{ padding: 28, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <p className="panel-title" style={{ marginBottom: 0 }}>Swaption</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="enc-badge">strike encrypted</span>
          <span className="enc-badge">notional encrypted</span>
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className={mode === 'write' ? 'btn-ghost' : 'btn-outline'}
          style={{ padding: '6px 14px', fontSize: 12, border: mode === 'write' ? '1px solid rgba(255,255,255,0.3)' : undefined, color: mode === 'write' ? 'var(--text)' : 'var(--text-dim)' }}
          onClick={() => setMode('write')}
        >Write Swaption</button>
        <button
          className={mode === 'exercise' ? 'btn-ghost' : 'btn-outline'}
          style={{ padding: '6px 14px', fontSize: 12, border: mode === 'exercise' ? '1px solid rgba(255,255,255,0.3)' : undefined, color: mode === 'exercise' ? 'var(--text)' : 'var(--text-dim)' }}
          onClick={() => setMode('exercise')}
        >Exercise</button>
      </div>

      {mode === 'write' ? (
        <form onSubmit={handleWrite} style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>Buyer Address</label>
            <input className="input" type="text" placeholder="0x…" value={buyer} onChange={e => setBuyer(e.target.value)} required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6 }}>
                Strike Rate (bps / 30d) <span className="enc-badge" style={{ marginLeft: 4 }}>🔒</span>
              </label>
              <input className="input" type="number" placeholder="50" value={strikeRate} onChange={e => setStrikeRate(e.target.value)} required min="1" />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6 }}>
                Notional (micro-USDC) <span className="enc-badge" style={{ marginLeft: 4 }}>🔒</span>
              </label>
              <input className="input" type="number" placeholder="1000000" value={notional} onChange={e => setNotional(e.target.value)} required min="1" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6 }}>Expiry (Unix seconds)</label>
              <input className="input" type="number" placeholder={String(Math.floor(Date.now() / 1000) + 604800)} value={expiry} onChange={e => setExpiry(e.target.value)} required min="1" />
              {expiry && <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>{new Date(Number(expiry) * 1000).toLocaleString()}</p>}
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6 }}>Swap Term (days)</label>
              <input className="input" type="number" placeholder="360" value={swapTermDays} onChange={e => setSwapTermDays(e.target.value)} required min="1" />
            </div>
          </div>

          {status && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>{status}</p>
          )}
          {txHash && !confirming && (
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', textDecoration: 'underline' }}>
              View on Etherscan ↗
            </a>
          )}
          <button type="submit" className="btn-primary" disabled={busy || confirming} style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
            {busy || confirming ? 'Processing…' : 'Write Swaption'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleExercise} style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>Swaption ID</label>
            <input className="input" type="number" placeholder="1" value={exerciseId} onChange={e => setExerciseId(e.target.value)} required min="1" />
          </div>
          <div style={{
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 11,
            color: 'var(--text-dim)',
            lineHeight: 1.7,
          }}>
            Only the buyer can exercise. If floating rate &gt; strike (inside FHE), exercising creates a live swap.
          </div>
          {status && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>{status}</p>
          )}
          {txHash && !confirming && (
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', textDecoration: 'underline' }}>
              View on Etherscan ↗
            </a>
          )}
          <button type="submit" className="btn-primary" disabled={busy || confirming} style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
            {busy || confirming ? 'Processing…' : 'Exercise Swaption'}
          </button>
        </form>
      )}
    </div>
  );
}
