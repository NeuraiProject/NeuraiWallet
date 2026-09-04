/**
 * Opens an `xna:` payment request.
 *
 * The wallet registers the `xna:` scheme, so a link or a scanned code can arrive
 * with no wallet in context. Sending needs one, and choosing it takes a callback
 * that a string-based navigation route cannot carry, so the two entry points
 * (the scanner on the wallet list, and the deep-link handlers) come through here
 * instead of through `NeuraiUriMatch.navigationRouteFor`.
 *
 * With a single wallet there is nothing to choose, so it goes straight to the
 * send screen.
 */

import type { TWallet } from '../class/wallets/types';
import type { TNavigationWrapper } from '../navigation/DetailViewStackParamList';
import type { NeuraiPaymentUri } from '../class/neurai-uri-match';

interface Navigator {
  navigate: (...args: never[]) => void;
}

const sendParams = (walletID: string, payment: NeuraiPaymentUri) => ({
  walletID,
  address: payment.address,
  amount: payment.amount !== undefined && payment.amount !== '' ? Number(payment.amount) : undefined,
});

/**
 * Navigates to the send screen for `payment`, asking which wallet to spend from
 * when there is more than one. Returns false when there is no wallet at all, so
 * the caller can tell the user instead of navigating into an empty screen.
 */
export function openNeuraiPaymentUri(navigation: Navigator, wallets: TWallet[], payment: NeuraiPaymentUri): boolean {
  const spendable = wallets.filter(wallet => (wallet.allowSend ? wallet.allowSend() : true));
  if (spendable.length === 0) return false;

  if (spendable.length === 1) {
    (navigation.navigate as (screen: string, params: unknown) => void)('SendNeurai', sendParams(spendable[0].getID(), payment));
    return true;
  }

  (navigation.navigate as (screen: string, params: unknown) => void)('SelectWallet', {
    availableWallets: spendable,
    onChainRequireSend: true,
    onWalletSelect: (wallet: TWallet, { navigation: wrapper }: TNavigationWrapper) => {
      wrapper.pop();
      wrapper.navigate('SendNeurai', sendParams(wallet.getID(), payment));
    },
  });
  return true;
}
