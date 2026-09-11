/**
 * Whether a wallet's DePIN address has published its key — gates the DePIN
 * badge on the wallet card. See blue_modules/neurai/depinRevealed for the
 * cache; this hook only supplies the address for the unsettled case, deriving
 * it once per wallet and off the render path, the way the chat itself does.
 *
 * Hardware wallets keep their key on the device, so their address cannot be
 * derived here: their badge appears once the chat has been opened with the
 * device and settled the answer.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

import { deriveDepinChatIdentity, isDepinChatSupportedNetwork } from '../blue_modules/neurai/depinChatIdentity';
import { ensureRevealed, isKnownRevealed, subscribeRevealed } from '../blue_modules/neurai/depinRevealed';
import { isNeuraiWallet } from '../class/wallets/is-neurai-wallet';
import { NeuraiHardwareWallet } from '../class/wallets/neurai-hardware-wallet';
import type { TWallet } from '../class/wallets/types';

/** Address per wallet id, derived at most once per app session. */
const addresses = new Map<string, string | null>();

/** Same cadence as the chat's own pubkey poll; only runs while unrevealed. */
const RECHECK_MS = 60_000;

function depinAddressFor(wallet: TWallet): string | null {
  const id = wallet.getID();
  if (addresses.has(id)) return addresses.get(id) ?? null;
  let address: string | null = null;
  if (isNeuraiWallet(wallet) && wallet.type !== NeuraiHardwareWallet.type && isDepinChatSupportedNetwork(wallet.network) && wallet.secret) {
    try {
      address = deriveDepinChatIdentity({ network: wallet.network, mnemonic: wallet.secret, passphrase: wallet.passphrase ?? '' }).address;
    } catch (error) {
      console.debug('[useDepinRevealed] could not derive DePIN address', error);
    }
  }
  addresses.set(id, address);
  return address;
}

export function useDepinRevealed(params: { enabled: boolean; wallet: TWallet | null }): boolean {
  const { enabled, wallet } = params;
  const walletID = wallet?.getID() ?? '';
  const [revealedState, setRevealedState] = useState(() => (walletID ? isKnownRevealed(walletID) : false));

  useEffect(() => {
    if (!enabled || !wallet || !isNeuraiWallet(wallet)) {
      setRevealedState(false);
      return;
    }
    const id = wallet.getID();
    const network = wallet.getNeuraiNetwork();
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const sync = () => {
      if (!cancelled) setRevealedState(isKnownRevealed(id));
    };
    const tick = () => {
      ensureRevealed(id, depinAddressFor(wallet), network).then(sync);
    };

    sync();
    // Key derivation is the expensive part: keep it off the first paint.
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      tick();
      if (!isKnownRevealed(id)) interval = setInterval(tick, RECHECK_MS);
    });
    // The chat settles the answer too (and is the only path for hardware
    // wallets); reflect it without waiting for the next tick.
    const unsubscribe = subscribeRevealed(sync);

    return () => {
      cancelled = true;
      task.cancel();
      if (interval) clearInterval(interval);
      unsubscribe();
    };
  }, [enabled, wallet]);

  return revealedState;
}

export default useDepinRevealed;
