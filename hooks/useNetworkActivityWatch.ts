/**
 * Lights the switcher's dot when a wallet on the network the user is *not*
 * looking at receives coins.
 *
 * Runs app-wide (from useCompanionListeners), not from the home screen: the
 * receipt can land while the user is deep in another screen, or right after a
 * cold start when the WSS catch-up pulls in what arrived while the app was
 * closed. It watches the `wallets` array, whose identity bumps on every
 * push-driven refetch, and compares per-wallet incoming counts against the
 * last snapshot. The first snapshot is a silent baseline.
 */
import { useEffect, useRef } from 'react';

import { detectIncomingActivity } from '../blue_modules/neurai/networkSelection';
import { useSettings } from './context/useSettings';
import { useStorage } from './context/useStorage';

export function useNetworkActivityWatch(): void {
  const { wallets, walletsInitialized } = useStorage();
  const { markNetworkUnseen } = useSettings();
  const snapshot = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!walletsInitialized) return;
    const { next, networksWithNew } = detectIncomingActivity(snapshot.current, wallets);
    snapshot.current = next;
    // markNetworkUnseen ignores the network on screen, so this is safe to call
    // for every network that moved.
    networksWithNew.forEach(network => {
      markNetworkUnseen(network).catch(err => console.debug('[useNetworkActivityWatch] mark failed', err));
    });
  }, [wallets, walletsInitialized, markNetworkUnseen]);
}

export default useNetworkActivityWatch;
