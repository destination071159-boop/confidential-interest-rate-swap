'use client';

import { useState } from 'react';
import { useAllow, useIsAllowed, useUserDecrypt } from '@zama-fhe/react-sdk';
import { TOKEN_ADDRESS } from '@/lib/contracts';

interface Props {
  handle: `0x${string}`;
}

const CONTRACTS: [`0x${string}`] = [TOKEN_ADDRESS];
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

export function DecryptTokenBalance({ handle }: Props) {
  const [clicked, setClicked] = useState(false);
  const { mutateAsync: allow, isPending: isAllowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: CONTRACTS });

  const { data: decrypted, isPending: isDecrypting } = useUserDecrypt(
    { handles: [{ handle, contractAddress: TOKEN_ADDRESS }] },
    { enabled: clicked && !!isAllowed && !!handle && handle !== NULL_HANDLE },
  );

  const raw = decrypted?.[handle];

  async function handleClick() {
    if (!isAllowed) await allow(CONTRACTS).catch(() => {});
    setClicked(true);
  }

  if (!handle || handle === NULL_HANDLE) {
    return <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>0.00 cUSDC</span>;
  }

  if (raw !== undefined) {
    const usdc = (Number(raw as bigint) / 1_000_000).toFixed(2);
    return (
      <span style={{ fontSize: 11, color: 'var(--text)' }}>{usdc} cUSDC</span>
    );
  }

  if (isAllowing) {
    return <span style={{ ...BOX, color: 'var(--text-dim)', fontSize: 11 }}>Signing…</span>;
  }

  if (clicked && isDecrypting) {
    return <span style={{ ...BOX, color: 'var(--text-dim)', fontSize: 11 }}>Decrypting…</span>;
  }

  return (
    <button style={BTN} onClick={handleClick}>
      🔒 Decrypt
    </button>
  );
}
