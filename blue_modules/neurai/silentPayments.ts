/**
 * NIP-047 silent payments: helpers shared by the receive and send screens.
 * The protocol itself lives in `@neuraiproject/neurai-silent-payments`.
 */

import type { NetworkName } from '@neuraiproject/neurai-silent-payments';
import { isTestnetChain, type NeuraiChainType } from './networkConfig';

/** Network of the payment codes of a wallet chain (`nsp1…` main, `tnsp1…` test). */
export function silentPaymentNetworkFor(chain: NeuraiChainType): NetworkName {
  return isTestnetChain(chain) ? 'test' : 'main';
}

/** True for text shaped like a payment code. The checksum and network are checked when it is used. */
export function looksLikeSilentPaymentCode(text: string): boolean {
  return /^t?nsp1/i.test(text.trim());
}
