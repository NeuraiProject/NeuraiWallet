import type { NeuraiNetwork } from '../../blue_modules/neurai';

export const ONE_COIN = 1e8;
// The reveal burn itself only needs 0.1 XNA; when the chat address is empty we
// suggest sending 1 XNA so the burn plus network fees are comfortably covered.
export const REVEAL_AMOUNT_XNA = 0.1;
export const FUND_AMOUNT_XNA = 1;
export const PUBKEY_POLL_MS = 25_000;
// After a successful reveal broadcast the burn button stays disabled this long,
// so a second tap can't double-burn while the tx confirms; if the pubkey still
// hasn't appeared afterwards (tx dropped?), the button re-enables to retry.
export const REVEAL_RETRY_MS = 120_000;
// Persisted last-known Ready state, keyed by chat address, so the badge shows
// the previous color instantly on entry instead of defaulting to red while the
// server / pubkey checks are still in flight.
export const READY_STATE_PREFIX = 'depin_ready_';

export const BURN_ADDRESS: Record<NeuraiNetwork, string> = {
  mainnet: 'NbURNXXXXXXXXXXXXXXXXXXXXXXXT65Gdr',
  testnet: 'tBURNXXXXXXXXXXXXXXXXXXXXXXXVZLroy',
};
