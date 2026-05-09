'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWatchContractEvent, usePublicClient } from 'wagmi';
import { PROTOCOL_ADDRESS, PROTOCOL_ABI } from '@/lib/contracts';
import { shorten } from '@/lib/utils';

interface SwapRow {
  id: bigint;
  party1: string;
  party2: string;
  maturityDate: bigint;
  status: string;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:  '#4ade80',
  EXPIRED: '#facc15',
  CLOSED:  '#6b7280',
};

function SwapRowItem({ id, address }: { id: bigint; address: string }) {
  const { data, isLoading } = useReadContract({
    address: PROTOCOL_ADDRESS,
    abi: PROTOCOL_ABI,
    functionName: 'getSwapStatus',
    args: [id],
  });

  const { writeContractAsync } = useWriteContract();
  const [settling, setSettling] = useState(false);

  async function handleSettle() {
    setSettling(true);
    try {
      await writeContractAsync({
        address: PROTOCOL_ADDRESS,
        abi: PROTOCOL_ABI,
        functionName: 'settleIfDue',
        args: [id],
      });
    } catch {}
    setSettling(false);
  }

  if (isLoading || !data) {
    return (
      <tr>
        <td colSpan={5} style={{ padding: '10px 12px', color: 'var(--text-dim)', fontSize: 11 }}>
          Loading #{id.toString()}…
        </td>
      </tr>
    );
  }

  const [party1, party2, maturityDate, status] = data as [string, string, bigint, string];
  const maturity = new Date(Number(maturityDate) * 1000).toLocaleDateString();
  const isMySwap = address.toLowerCase() === party1.toLowerCase() ||
                   address.toLowerCase() === party2.toLowerCase();
  const statusColor = STATUS_COLOR[status] ?? '#6b7280';

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={TD}>{id.toString()}</td>
      <td style={TD}>
        <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{shorten(party1)}</span>
        <span style={{ color: 'var(--text-dim)', margin: '0 4px', fontSize: 10 }}>↔</span>
        <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{shorten(party2)}</span>
      </td>
      <td style={TD}>{maturity}</td>
      <td style={TD}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: statusColor,
          background: `${statusColor}18`,
          border: `1px solid ${statusColor}40`,
          borderRadius: 4,
          padding: '2px 7px',
        }}>
          {status}
        </span>
      </td>
      <td style={{ ...TD, textAlign: 'right' }}>
        {status === 'ACTIVE' && isMySwap && (
          <button
            onClick={handleSettle}
            disabled={settling}
            style={{
              fontSize: 10,
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              color: 'var(--text-muted)',
              cursor: settling ? 'not-allowed' : 'pointer',
            }}
          >
            {settling ? 'Settling…' : 'Settle'}
          </button>
        )}
      </td>
    </tr>
  );
}

const TD: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 11,
  color: 'var(--text-muted)',
  verticalAlign: 'middle',
};

const TH: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-dim)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  textAlign: 'left' as const,
  borderBottom: '1px solid var(--border)',
};

export function SwapTable() {
  const { address, isConnected } = useAccount();
  const [swapIds, setSwapIds] = useState<bigint[]>([]);
  const publicClient = usePublicClient();

  function addId(id: bigint) {
    setSwapIds(prev => prev.includes(id) ? prev : [...prev, id].sort((a, b) => Number(b - a)));
  }

  // Fetch past SwapInitiated events on mount
  useEffect(() => {
    if (!publicClient || !address) return;
    publicClient.getLogs({
      address: PROTOCOL_ADDRESS,
      event: {
        type: 'event',
        name: 'SwapInitiated',
        inputs: [
          { name: 'swapId', type: 'uint256', indexed: true },
          { name: 'party1', type: 'address', indexed: true },
          { name: 'party2', type: 'address', indexed: true },
          { name: 'termDays', type: 'uint256', indexed: false },
        ],
      },
      fromBlock: 0n,
      toBlock: 'latest',
    }).then(logs => {
      for (const log of logs) {
        const id = (log as any).args?.swapId as bigint | undefined;
        if (id !== undefined) addId(id);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!publicClient, address]);

  // Also watch for new live events
  useWatchContractEvent({
    address: PROTOCOL_ADDRESS,
    abi: PROTOCOL_ABI,
    eventName: 'SwapInitiated',
    onLogs(logs) {
      for (const log of logs) {
        const id = (log as any).args?.swapId as bigint | undefined;
        if (id !== undefined) addId(id);
      }
    },
  });

  if (!isConnected) return null;

  return (
    <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="panel-title" style={{ marginBottom: 0 }}>Active Swaps</p>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          {swapIds.length} swap{swapIds.length !== 1 ? 's' : ''} detected this session
        </span>
      </div>

      {swapIds.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            No swaps yet. Initiate a swap above — it will appear here.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>ID</th>
                <th style={TH}>Counterparties</th>
                <th style={TH}>Maturity</th>
                <th style={TH}>Status</th>
                <th style={{ ...TH, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {swapIds.map(id => (
                <SwapRowItem key={id.toString()} id={id} address={address ?? ''} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
