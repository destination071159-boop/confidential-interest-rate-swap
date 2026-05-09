'use client';

import { useAccount, useReadContract } from 'wagmi';
import { SETTLEMENT_ENGINE_ADDRESS, SETTLEMENT_ENGINE_ABI, TOKEN_ADDRESS, TOKEN_ABI } from '@/lib/contracts';
import { DecryptCollateral } from './DecryptCollateral';
import { DecryptTokenBalance } from './DecryptTokenBalance';
import { MintPanel } from './MintPanel';
import { shorten } from '@/lib/utils';

export function AccountSection() {
  const { address, isConnected } = useAccount();

  const { data: tokenBalanceHandle } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address },
  });

  const { data: collateralHandle } = useReadContract({
    address: SETTLEMENT_ENGINE_ADDRESS,
    abi: SETTLEMENT_ENGINE_ABI,
    functionName: 'getMyCollateral',
    query: { enabled: isConnected },
  });

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
              <span className="mono">
                {tokenBalanceHandle
                  ? <DecryptTokenBalance handle={tokenBalanceHandle as `0x${string}`} />
                  : <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>}
              </span>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No wallet connected.</p>
        )}
      </div>

      {/* Vault collateral balance */}
      <div className="glass" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <p className="panel-title" style={{ marginBottom: 0 }}>Vault Collateral</p>
          <span className="enc-badge">🔒 FHE</span>
        </div>
        {isConnected && collateralHandle != null ? (
          <DecryptCollateral handle={collateralHandle as `0x${string}`} />
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {isConnected ? 'Loading…' : 'Connect wallet to view.'}
          </p>
        )}
      </div>

      {/* Mint */}
      <MintPanel />
    </div>
  );
}
