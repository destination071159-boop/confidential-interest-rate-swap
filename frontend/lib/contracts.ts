// ─── Contract addresses ────────────────────────────────────────────────────────
// Populated from environment variables after Sepolia deployment.
// Copy .env.local.example → .env.local and fill in your deployed addresses.

export const PROTOCOL_ADDRESS = (
  process.env.NEXT_PUBLIC_PROTOCOL_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const SETTLEMENT_ENGINE_ADDRESS = (
  process.env.NEXT_PUBLIC_SETTLEMENT_ENGINE_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const SWAP_MANAGER_ADDRESS = (
  process.env.NEXT_PUBLIC_SWAP_MANAGER_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const SWAP_POOL_ADDRESS = (
  process.env.NEXT_PUBLIC_SWAP_POOL_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const SWAPTION_VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_SWAPTION_VAULT_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const RATE_ORACLE_ADDRESS = (
  process.env.NEXT_PUBLIC_RATE_ORACLE_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

export const PROTOCOL_ABI = [
  {
    name: 'initiateSwap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'counterparty',  type: 'address' },
      { name: 'encNotional',   type: 'bytes32' },
      { name: 'encFixedRate',  type: 'bytes32' },
      { name: 'inputProof',    type: 'bytes'   },
      { name: 'termDays',      type: 'uint256' },
    ],
    outputs: [{ name: 'swapId', type: 'uint256' }],
  },
  {
    name: 'settleIfDue',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swapId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'closeAtMaturity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swapId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'settleNetted',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swapIds', type: 'uint256[]' }],
    outputs: [],
  },
  {
    name: 'getSwapStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'swapId', type: 'uint256' }],
    outputs: [
      { name: 'party1',       type: 'address' },
      { name: 'party2',       type: 'address' },
      { name: 'maturityDate', type: 'uint256' },
      { name: 'status',       type: 'uint8'   },
    ],
  },
  {
    name: 'getSwapFixedRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'swapId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'getCurrentFloatingRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    name: 'SwapInitiated',
    type: 'event',
    inputs: [
      { name: 'swapId',      type: 'uint256', indexed: true  },
      { name: 'party1',      type: 'address', indexed: true  },
      { name: 'party2',      type: 'address', indexed: true  },
      { name: 'maturityDate',type: 'uint256', indexed: false },
    ],
  },
] as const;

export const SETTLEMENT_ENGINE_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encAmount',  type: 'bytes32' },
      { name: 'inputProof', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encAmount',  type: 'bytes32' },
      { name: 'inputProof', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'getMyCollateral',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'setMinCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'minAmount', type: 'uint64' }],
    outputs: [],
  },
  {
    name: 'liquidate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'party', type: 'address' }],
    outputs: [],
  },
  {
    name: 'transferPaymentDirectional',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'party1',       type: 'address' },
      { name: 'party2',       type: 'address' },
      { name: 'paymentScaled',type: 'bytes32' },
      { name: 'party1Pays',   type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'Deposit',
    type: 'event',
    inputs: [
      { name: 'user',   type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdraw',
    type: 'event',
    inputs: [
      { name: 'user',   type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Liquidated',
    type: 'event',
    inputs: [
      { name: 'party',      type: 'address', indexed: true  },
      { name: 'liquidator', type: 'address', indexed: true  },
    ],
  },
] as const;

export const SWAP_POOL_ABI = [
  {
    name: 'settleSwap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swapId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'closeAtMaturity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swapId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'settleNetted',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swapIds', type: 'uint256[]' }],
    outputs: [],
  },
  {
    name: 'SwapsNetted',
    type: 'event',
    inputs: [
      { name: 'party1',    type: 'address', indexed: true  },
      { name: 'party2',    type: 'address', indexed: true  },
      { name: 'swapCount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const SWAPTION_VAULT_ABI = [
  {
    name: 'writeSwaption',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'buyer',        type: 'address' },
      { name: 'encStrike',    type: 'bytes32' },
      { name: 'encNotional',  type: 'bytes32' },
      { name: 'inputProof',   type: 'bytes'   },
      { name: 'expiry',       type: 'uint256' },
      { name: 'swapTermDays', type: 'uint256' },
    ],
    outputs: [{ name: 'swaptionId', type: 'uint256' }],
  },
  {
    name: 'exerciseSwaption',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swaptionId', type: 'uint256' }],
    outputs: [{ name: 'swapId', type: 'uint256' }],
  },
  {
    name: 'lapseSwaption',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'swaptionId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getStrikeRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'swaptionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'isExercised',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'swaptionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'SwaptionWritten',
    type: 'event',
    inputs: [
      { name: 'swaptionId', type: 'uint256', indexed: true  },
      { name: 'writer',     type: 'address', indexed: true  },
      { name: 'buyer',      type: 'address', indexed: true  },
      { name: 'expiry',     type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'SwaptionExercised',
    type: 'event',
    inputs: [
      { name: 'swaptionId', type: 'uint256', indexed: true  },
      { name: 'buyer',      type: 'address', indexed: true  },
      { name: 'swapId',     type: 'uint256', indexed: false },
    ],
  },
] as const;

export const RATE_ORACLE_ABI = [
  {
    name: 'getCurrentRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    name: 'setRate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'rate', type: 'uint64' }],
    outputs: [],
  },
] as const;

export const TOKEN_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',     type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'setOperator',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool'    },
    ],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
