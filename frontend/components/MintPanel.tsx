'use client';

import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { TOKEN_ADDRESS, TOKEN_ABI } from '@/lib/contracts';

const PRESETS = [
  { label: '10 USDC',   value: 10_000_000 },
  { label: '50 USDC',   value: 50_000_000 },
  { label: '100 USDC',  value: 100_000_000 },
];

export function MintPanel({ onMinted }: { onMinted?: () => void }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('10000000');
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy,   setBusy]   = useState(false);

  const { isLoading: confirming } = useWaitForTransactionReceipt({
    hash: txHash,
    onReplaced: () => onMinted?.(),
  });

  useEffect(() => {
    if (txHash && !confirming && status === 'Minting…') {
      setStatus('Minted! Tokens will appear above.');
      onMinted?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming, txHash]);

  const usdcDisplay = amount ? (Number(amount) / 1_000_000).toFixed(2) : '0.00';

  async function handleMint() {
    if (!isConnected || !address) return;
    setBusy(true);
    setStatus('Waiting for wallet confirmation…');
    try {
      const hash = await writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: 'mint',
        args: [address, BigInt(amount)],
        gas: 15_000_000n,
      });
      setTxHash(hash);
      setStatus('Minting…');
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) return null;

  const isPending = busy || confirming;

  return (
    <div className="glass" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p className="panel-title" style={{ marginBottom: 0 }}>Mint Test cUSDC</p>
        <span style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '2px 8px',
        }}>Testnet only</span>
      </div>

      {/* Preset buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => setAmount(String(p.value))}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: 11,
              background: amount === String(p.value) ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${amount === String(p.value) ? 'var(--border-strong)' : 'var(--border)'}`,
              borderRadius: 6,
              color: amount === String(p.value) ? 'var(--text)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom amount */}
      <div style={{ marginBottom: 12 }}>
        <label className="label" style={{ display: 'block', marginBottom: 6 }}>
          Amount (micro-USDC)
        </label>
        <input
          className="input"
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="10000000"
          min="1"
        />
        <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          = {usdcDisplay} USDC
        </p>
      </div>

      <button
        className="btn-primary"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={isPending || !amount || Number(amount) <= 0}
        onClick={handleMint}
      >
        {isPending ? 'Minting…' : `Mint ${usdcDisplay} cUSDC`}
      </button>

      {status && (
        <p style={{
          marginTop: 10,
          fontSize: 11,
          color: status.startsWith('Error') ? '#ff6b6b' : 'var(--text-muted)',
          wordBreak: 'break-all',
        }}>
          {confirming ? '⏳ ' : ''}{status}
          {txHash && !confirming && (
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--text-muted)', marginLeft: 6, textDecoration: 'underline' }}
            >
              Etherscan ↗
            </a>
          )}
        </p>
      )}

      <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.6 }}>
        Free test tokens. After minting, deposit into the Collateral vault to use for swaps.
      </p>
    </div>
  );
}
