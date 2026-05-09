// Shim: @zama-fhe/react-sdk imports 'watchConnections' from wagmi/actions,
// but the function was renamed to 'watchConnections' in wagmi v2 while older
// SDK builds still call it 'watchConnection' (singular). This shim re-exports
// under both names so the SDK resolves cleanly at runtime.
export { watchConnections as watchConnection } from 'wagmi/actions';
export * from 'wagmi/actions';
