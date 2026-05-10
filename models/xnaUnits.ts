/**
 * Display units for the wallet UI.
 *
 * Neurai uses the same 1e8 base unit denomination as Bitcoin (chain
 * `amount.h`: `static const CAmount COIN = 100000000`). The official
 * libraries (`neurai-jswallet`, `neurai-create-transaction`) name the
 * smallest unit **sat** / **satoshis** internally (e.g. `IUTXO.satoshis`,
 * `SATS_PER_XNA`), so we mirror that here.
 *
 *   1 XNA = 100_000_000 sats
 */
export const XnaUnit = {
  XNA: 'XNA',
  SATS: 'sats',
  LOCAL_CURRENCY: 'local_currency',
  MAX: 'MAX',
} as const;
export type XnaUnit = (typeof XnaUnit)[keyof typeof XnaUnit];

/**
 * Lightning was removed from the product (Neurai does not have an LN), so
 * `Chain.OFFCHAIN` no longer exists. We keep the enum so that consumers that
 * checked `wallet.chain === Chain.ONCHAIN` keep compiling without changes.
 */
export const Chain = {
  ONCHAIN: 'ONCHAIN',
} as const;
export type Chain = (typeof Chain)[keyof typeof Chain];
