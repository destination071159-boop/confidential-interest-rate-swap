/** Shorten a hex address: 0x1234…abcd */
export function shorten(addr: string, chars = 4): string {
  if (!addr) return '';
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

/** Format micro-USDC (6 decimals) to human-readable */
export function formatMicroUsdc(raw: bigint | number): string {
  const n = typeof raw === 'bigint' ? Number(raw) : raw;
  return (n / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/** Format basis points per 30-day period to approximate annual % string */
export function formatBps(bps: bigint | number): string {
  const n = typeof bps === 'bigint' ? Number(bps) : bps;
  const annPct = (n / 10_000) * (365 / 30) * 100;
  return `${n} bps (~${annPct.toFixed(1)}% annual)`;
}
