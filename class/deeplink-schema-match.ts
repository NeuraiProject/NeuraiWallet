/**
 * Legacy Bitcoin-era deep links and BIP21 helpers.
 *
 * This file is what is left of BlueWallet's deep-link router after the Neurai
 * fork removed the Bitcoin and Lightning screens. It now holds only the pieces
 * live code still calls:
 *
 * - `hasSchema` / `isBitcoinAddress`: recognition of the inherited `bitcoin:`,
 *   `blue:` and `bluewallet:` links and of bare Bitcoin addresses, used by the
 *   clipboard watcher (`hooks/useCompanionListeners.ts`), the home-screen quick
 *   actions (`hooks/useDeviceQuickActions.ts`) and `class/neurai-uri-match.ts`.
 * - `bip21encode` / `bip21decode`: BIP21 encoding and decoding for the Receive
 *   screens. Neurai reuses the BIP21 grammar with the `xna` URN scheme.
 * - `navigationRouteFor`: the iOS home-screen widget's "receive" button, the
 *   only deep link left whose destination screen still exists.
 * - `getServerFromSetElectrumServerAction`: still called by
 *   `screen/settings/ElectrumSettings.tsx`.
 *
 * Everything else was deleted because it pointed at screens this fork does not
 * have (`SendDetailsRoot`, `SendDetails`, `PsbtWithHardwareWallet`, the LNURL
 * and Lightning invoice flows) or at features it never shipped (`.psbt` and
 * `.bwcosigner` file imports, multisig cosigner sharing).
 *
 * Neurai's own URIs — `nc:` pairings, `xna:` payment requests and
 * `neuraiwallet://connect` — are NOT handled here. They live in
 * `class/neurai-uri-match.ts`, which is the entry point for the scanner and
 * for deep links, and which delegates the legacy schemes above to this class.
 */

import bip21, { TOptions } from 'bip21';
import * as bitcoin from 'bitcoinjs-lib';
import { Chain } from '../models/xnaUnits';
import type { TWallet } from './wallets/types';

type TCompletionHandlerParams = [string, object];
/**
 * Only `wallets` is read today. The other three are still declared because the
 * live callers (`useCompanionListeners`, `useDeviceQuickActions`) pass them as
 * an object literal, and TypeScript rejects excess properties on those.
 */
type TContext = {
  wallets: TWallet[];
  saveToDisk: () => void;
  addWallet: (wallet: TWallet) => void;
  setSharedCosigner: (cosigner: string) => void;
};

class DeeplinkSchemaMatch {
  static hasSchema(schemaString: string): boolean {
    if (typeof schemaString !== 'string' || schemaString.length <= 0) return false;
    const lowercaseString = schemaString.trim().toLowerCase();
    return lowercaseString.startsWith('bitcoin:') || lowercaseString.startsWith('blue:') || lowercaseString.startsWith('bluewallet:');
  }

  /**
   * Examines the content of the event parameter.
   * If the content is recognizable, create a dictionary with the respective
   * navigation dictionary required by react-navigation.
   *
   * The only link still recognised is `bluewallet://widget?action=openReceive`,
   * emitted by the iOS home-screen widget (`ios/Widgets/Shared/Views/SendReceiveButtons.swift`).
   * Its `openSend` sibling is deliberately ignored: it opened `SendDetailsRoot`,
   * a Bitcoin route that no longer exists in this fork.
   *
   * @param event {{url: string}} URL deeplink as passed to app, e.g. `bluewallet://widget?action=openReceive`
   * @param completionHandler {function} Callback that returns [string, params: object]
   */
  static navigationRouteFor(
    event: { url: string },
    completionHandler: (args: TCompletionHandlerParams) => void,
    context: TContext = { wallets: [], saveToDisk: () => {}, addWallet: () => {}, setSharedCosigner: () => {} },
  ) {
    if (typeof event.url !== 'string') {
      return;
    }

    let url = event.url;
    if (url.toLocaleLowerCase().startsWith('bluewallet://widget?action=')) {
      url = url.substring('bluewallet://'.length);
    }

    if (!DeeplinkSchemaMatch.isWidgetAction(url)) return;
    if (url.split('widget?action=')[1] !== 'openReceive') return;

    const wallet = context.wallets[0];
    if (!wallet || wallet.chain !== Chain.ONCHAIN) return;

    completionHandler([
      'DetailViewStackScreensStack',
      {
        screen: 'ReceiveDetails',
        params: {
          walletID: wallet.getID(),
        },
      },
    ]);
  }

  /**
   * Extracts server from a deeplink like `bluewallet:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As`
   * returns FALSE if none found
   *
   * The deeplink itself is no longer routed — `ElectrumSettings` is Bitcoin-era
   * code on its way out — but the screen still uses this to parse a scanned QR.
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getServerFromSetElectrumServerAction(url: string): string | false {
    if (!url.startsWith('bluewallet:setelectrumserver') && !url.startsWith('setelectrumserver')) return false;
    const splt = url.split('server=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  static isBitcoinAddress(address: string): boolean {
    address = address.replace('://', ':').replace('bitcoin:', '').replace('BITCOIN:', '').replace('bitcoin=', '').split('?')[0];
    let isValidBitcoinAddress = false;
    try {
      bitcoin.address.toOutputScript(address);
      isValidBitcoinAddress = true;
    } catch (err) {
      isValidBitcoinAddress = false;
    }
    return isValidBitcoinAddress;
  }

  static isWidgetAction(text: string): boolean {
    return text.startsWith('widget?action=');
  }

  static bip21decode(uri?: string) {
    if (!uri) {
      throw new Error('No URI provided');
    }
    let replacedUri = uri;
    for (const replaceMe of ['BITCOIN://', 'bitcoin://', 'BITCOIN:']) {
      replacedUri = replacedUri.replace(replaceMe, 'bitcoin:');
    }

    return bip21.decode(replacedUri);
  }

  static bip21encode(address: string, options?: TOptions, urnScheme: string = 'bitcoin'): string {
    // uppercase address if bech32 to satisfy BIP_0173 (Bitcoin only)
    if (urnScheme === 'bitcoin' && address.startsWith('bc1')) {
      address = address.toUpperCase();
    }

    for (const key in options) {
      if (key === 'label' && String(options[key]).replace(' ', '').length === 0) {
        delete options[key];
      }
      if (key === 'amount' && !(Number(options[key]) > 0)) {
        delete options[key];
      }
    }
    return bip21.encode(address, options, urnScheme);
  }
}

export default DeeplinkSchemaMatch;
