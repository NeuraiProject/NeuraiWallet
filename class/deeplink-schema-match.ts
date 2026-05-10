import bip21, { TOptions } from 'bip21';
import * as bitcoin from 'bitcoinjs-lib';
import URL from 'url';
import { readFileOutsideSandbox } from '../blue_modules/fs';
import { Chain } from '../models/xnaUnits';
import type { TWallet } from './wallets/types';

type TCompletionHandlerParams = [string, object];
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
   * @param event {{url: string}} URL deeplink as passed to app, e.g. `bitcoin:bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7?amount=666&label=Yo`
   * @param completionHandler {function} Callback that returns [string, params: object]
   */
  static navigationRouteFor(
    event: { url: string },
    completionHandler: (args: TCompletionHandlerParams) => void,
    context: TContext = { wallets: [], saveToDisk: () => {}, addWallet: () => {}, setSharedCosigner: () => {} },
  ) {
    if (event.url === null) {
      return;
    }
    if (typeof event.url !== 'string') {
      return;
    }

    if (event.url.toLowerCase().startsWith('bluewallet:bitcoin:')) {
      event.url = event.url.substring(11);
    } else if (event.url.toLocaleLowerCase().startsWith('bluewallet://widget?action=')) {
      event.url = event.url.substring('bluewallet://'.length);
    }

    if (DeeplinkSchemaMatch.isWidgetAction(event.url)) {
      if (context.wallets.length >= 0) {
        const wallet = context.wallets[0];
        const action = event.url.split('widget?action=')[1];
        if (wallet.chain === Chain.ONCHAIN) {
          if (action === 'openSend') {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'SendDetails',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          } else if (action === 'openReceive') {
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
        }
      }
    } else if (DeeplinkSchemaMatch.isPossiblyPSBTFile(event.url)) {
      readFileOutsideSandbox(decodeURI(event.url))
        .then(file => {
          if (file) {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'PsbtWithHardwareWallet',
                params: {
                  deepLinkPSBT: file,
                },
              },
            ]);
          }
        })
        .catch(e => console.warn(e));
      return;
    } else if (DeeplinkSchemaMatch.isPossiblyCosignerFile(event.url)) {
      readFileOutsideSandbox(decodeURI(event.url))
        .then(file => {
          // checks whether the necessary json keys are present in order to set a cosigner,
          // doesn't validate the values this happens later
          if (!file || !this.hasNeededJsonKeysForMultiSigSharing(file)) {
            return;
          }
          context.setSharedCosigner(file);
        })
        .catch(e => console.warn(e));
      return;
    }

    if (DeeplinkSchemaMatch.isBitcoinAddress(event.url)) {
      completionHandler([
        'SendDetailsRoot',
        {
          screen: 'SendDetails',
          params: {
            uri: event.url.replace('://', ':'),
          },
        },
      ]);
    } else {
      const urlObject = URL.parse(event.url, true); // eslint-disable-line n/no-deprecated-api
      (async () => {
        if (urlObject.protocol === 'bluewallet:' || urlObject.protocol === 'blue:') {
          if (urlObject.host === 'setelectrumserver') {
            completionHandler([
              'ElectrumSettings',
              {
                server: DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(event.url),
              },
            ]);
          }
        }
      })();
    }
  }

  /**
   * Extracts server from a deeplink like `bluewallet:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As`
   * returns FALSE if none found
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

  static isTXNFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.txn');
  }

  static isPossiblyPSBTFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.psbt');
  }

  static isPossiblyCosignerFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.bwcosigner');
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

  static hasNeededJsonKeysForMultiSigSharing(str: string): boolean {
    let obj;

    // Check if it's a valid JSON
    try {
      obj = JSON.parse(str);
    } catch (e) {
      return false;
    }

    // Check for the existence and type of the keys
    return typeof obj.xfp === 'string' && typeof obj.xpub === 'string' && typeof obj.path === 'string';
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

  static decodeBitcoinUri(uri: string) {
    let amount;
    let address = uri || '';
    let memo = '';
    let payjoinUrl = '';
    try {
      const parsedBitcoinUri = DeeplinkSchemaMatch.bip21decode(uri);
      address = parsedBitcoinUri.address ? parsedBitcoinUri.address.toString() : address;
      if ('options' in parsedBitcoinUri) {
        if (parsedBitcoinUri.options.amount) {
          amount = Number(parsedBitcoinUri.options.amount);
        }
        if (parsedBitcoinUri.options.label) {
          memo = parsedBitcoinUri.options.label;
        }
        if (parsedBitcoinUri.options.pj) {
          payjoinUrl = parsedBitcoinUri.options.pj;
        }
      }
    } catch (_) {}
    return { address, amount, memo, payjoinUrl };
  }
}

export default DeeplinkSchemaMatch;
