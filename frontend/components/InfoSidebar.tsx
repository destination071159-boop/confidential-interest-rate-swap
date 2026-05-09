'use client';

import { useEffect, useState } from 'react';
import { useReadContract } from 'wagmi';
import { RATE_ORACLE_ADDRESS, RATE_ORACLE_ABI, PROTOCOL_ADDRESS, PROTOCOL_ABI } from '@/lib/contracts';

export function InfoSidebar() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: floatingRate } = useReadContract({
    address: RATE_ORACLE_ADDRESS,
    abi: RATE_ORACLE_ABI,
    functionName: 'getCurrentRate',
    query: { enabled: mounted, refetchInterval: 15_000 },
  });

  const bps   = floatingRate ? Number(floatingRate as bigint) : null;
  const annPct = bps !== null ? ((bps / 10_000) * (365 / 30) * 100).toFixed(2) : null;

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div className="info-row">
        <span className="label">{label}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{value}</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Protocol info */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Protocol</p>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7 }}>
          <p>Fixed-for-floating IRS.</p>
          <p style={{ marginTop: 6 }}>Every parameter stays encrypted end-to-end via Zama FHEVM.</p>
        </div>

        <div className="divider" />

        {/* Privacy indicators */}
        <p className="label" style={{ marginBottom: 10 }}>Privacy guarantees</p>
        {['Notional', 'Fixed rate', 'Payment dir', 'Amount paid'].map(item => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>⬛</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item}</span>
            <span className="enc-badge" style={{ marginLeft: 'auto' }}>encrypted</span>
          </div>
        ))}
      </div>

      {/* Oracle */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Oracle</p>
        {mounted ? (
          <>
            <Row label="Floating rate" value={bps !== null ? `${bps} bps / 30d` : '—'} />
            <Row label="≈ Annual" value={annPct !== null ? `${annPct} %` : '—'} />
            <Row label="Source" value="SOFR (mock)" />
            <Row label="Period" value="30 days" />
          </>
        ) : (
          <span className="label">Loading…</span>
        )}
      </div>

      {/* Unit legend */}
      <div className="glass" style={{ padding: 20 }}>
        <p className="panel-title">Units</p>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          <p>Notional: micro-USDC (6 dec)</p>
          <p>1 USDC = 1,000,000</p>
          <p>Rate: bps per 30-day period</p>
          <p>50 bps ≈ 6 % annual</p>
        </div>
      </div>
    </div>
  );
}
