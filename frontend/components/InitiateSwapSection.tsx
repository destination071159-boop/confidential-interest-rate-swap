'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useEncrypt } from '@zama-fhe/react-sdk';
import { bytesToHex } from 'viem';
import { PROTOCOL_ADDRESS, PROTOCOL_ABI } from '@/lib/contracts';

export function InitiateSwapSection() {
  const { address, isConnected } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const [counterparty, setCounterparty] = useState('');
  const [notional,     setNotional]     = useState('');   // micro-USDC (e.g. 1000000 = 1 USDC)
  const [fixedRate,    setFixedRate]     = useState('');   // bps (e.g. 50)
  const [termDays,     setTermDays]      = useState('360');
  const [status,       setStatus]        = useState('');
  const [txHash,       setTxHash]        = useState<`0x${string}` | undefined>();
  const [busy,         setBusy]          = useState(false);

  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected || !address) return;
    setBusy(true);
    setStatus('Encrypting inputs…');
    try {
      const enc = await encrypt.mutateAsync({
        values: [
          { value: BigInt(notional),  type: 'euint64' },
          { value: BigInt(fixedRate), type: 'euint64' },
        ],
        contractAddress: PROTOCOL_ADDRESS,
        userAddress: address,
      });

      const encNotional   = bytesToHex(enc.handles[0]!);
      const encFixedRate  = bytesToHex(enc.handles[1]!);
      const inputProof    = bytesToHex(enc.inputProof);

      setStatus('Waiting for wallet confirmation…');
      const hash = await writeContractAsync({
        address: PROTOCOL_ADDRESS,
        abi: PROTOCOL_ABI,
        functionName: 'initiateSwap',
        args: [
          counterparty as `0x${string}`,
          encNotional,
          encFixedRate,
          inputProof,
          BigInt(termDays),
        ],
        gas: 15_000_000n,
      });
      setTxHash(hash);
      setStatus('Transaction submitted — waiting for confirmation…');
    } catch (err: any) {
      setStatus(`Error: ${err.shortMessage ?? err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="glass" style={{ padding: 28, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Connect wallet to initiate a swap.</p>
      </div>
    );
  }

  return (
    <div className="glass" style={{ padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <p className="panel-title" style={{ marginBottom: 0 }}>Initiate Swap</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="enc-badge">notional encrypted</span>
          <span className="enc-badge">rate encrypted</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label" style={{ display: 'block', marginBottom: 6 }}>Counterparty Address</label>
          <input
            className="input"
            type="text"
            placeholder="0x…"
            value={counterparty}
            onChange={e => setCounterparty(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>
              Notional (micro-USDC)
              <span className="enc-badge" style={{ marginLeft: 6 }}>🔒</span>
            </label>
            <input
              className="input"
              type="number"
              placeholder="1000000 = 1 USDC"
              value={notional}
              onChange={e => setNotional(e.target.value)}
              required min="1"
            />
          </div>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>
              Fixed Rate (bps / 30d)
              <span className="enc-badge" style={{ marginLeft: 6 }}>🔒</span>
            </label>
            <input
              className="input"
              type="number"
              placeholder="50 ≈ 6% annual"
              value={fixedRate}
              onChange={e => setFixedRate(e.target.value)}
              required min="1" max="1000"
            />
          </div>
        </div>

        <div>
          <label className="label" style={{ display: 'block', marginBottom: 6 }}>Term (days)</label>
          <input
            className="input"
            type="number"
            placeholder="360"
            value={termDays}
            onChange={e => setTermDays(e.target.value)}
            required min="1"
          />
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
        }}>
          You pay <strong style={{ color: 'var(--text-muted)' }}>fixed</strong> rate, counterparty pays{' '}
          <strong style={{ color: 'var(--text-muted)' }}>floating</strong> (SOFR oracle). Net payment is
          computed entirely inside FHE — neither direction nor amount is visible on-chain.
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={busy || confirming}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {busy || confirming ? 'Processing…' : 'Initiate Swap'}
        </button>

        {status && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, textAlign: 'center' }}>
            {status}
          </p>
        )}

        {txHash && !confirming && (
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', textDecoration: 'underline' }}
          >
            View on Etherscan ↗
          </a>
        )}
      </form>
    </div>
  );
}
