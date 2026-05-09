'use client';

import { useState } from 'react';
import { useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { formatMicroUsdc } from '@/lib/utils';
import { SETTLEMENT_ENGINE_ADDRESS } from '@/lib/contracts';

interface Props {
  handle: `0x${string}`;
}

const CONTRACTS: [`0x${string}`] = [SETTLEMENT_ENGINE_ADDRESS];

const NULL_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

const BOX: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  minWidth: 110,
  height: 24,
  fontSize: 11,
  borderRadius: 4,
  whiteSpace: 'nowrap',
};

const BTN: React.CSSProperties = {
  ...BOX,
  border: '1px solid var(--border-strong)',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

export function DecryptCollateral({ handle }: Props) {
  const [clicked, setClicked] = useState(false);
  const { mutateAsync: allow, isPending: isAllowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });

  const { data: decrypted, isPending: isDecrypting, isError, error } = useUserDecrypt(
    { handles: [{ handle, contractAddress: SETTLEMENT_ENGINE_ADDRESS }] },
    { enabled: clicked && !!isAllowed && !!handle && handle !== NULL_HANDLE },
  );

  const raw = decrypted?.[handle];

  async function handleClick() {
    if (!isAllowed) await allow(CONTRACTS).catch(() => {});
    setClicked(true);
  }

  if (raw !== undefined) {
    return (
      <div>
        <div style={{
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 10,
        }}>
          <p className="label" style={{ marginBottom: 4 }}>Balance</p>
          <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
            {formatMicroUsdc(raw as bigint)}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>USDC</p>
        </div>
        <button
          className="btn-ghost"
          style={{ width: '100%', justifyContent: 'center', fontSize: 11, padding: '6px 14px' }}
          onClick={() => setClicked(false)}
        >
          Hide
        </button>
      </div>
    );
  }

  if (isError) {
    return <span style={{ ...BOX, color: '#ff4444', fontSize: 11 }} title={error?.message}>Failed</span>;
  }

  if (clicked && isDecrypting) {
    return <span style={{ ...BOX, color: 'var(--text-dim)' }}>Decrypting…</span>;
  }

  return (
    <div>
      <div style={{
        padding: '12px 14px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span className="enc-badge">🔒 encrypted</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— decrypt to reveal</span>
      </div>
      <button
        className="btn-outline"
        style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
        disabled={isAllowing}
        onClick={handleClick}
      >
        {isAllowing ? 'Signing permit…' : 'Decrypt Balance'}
      </button>
    </div>
  );
}
