/**
 * The network the home screen is showing, and the wallets that belong on it.
 *
 * Wraps the persisted pick from settings with the wallets that actually exist:
 * the pick only counts while it has wallets (see `resolveNetworkView`). Every
 * home-screen surface — carousel, total balance, recent transactions, the
 * tablet drawer — reads from here so they cannot disagree about what is shown.
 */
import { useCallback, useMemo } from 'react';
import { LayoutAnimation } from 'react-native';

import type { NeuraiNetwork } from '../blue_modules/neurai/networkConfig';
import { otherNetwork, resolveNetworkView, walletNetwork } from '../blue_modules/neurai/networkSelection';
import type { TWallet } from '../class/wallets/types';
import { useSettings } from './context/useSettings';
import { useStorage } from './context/useStorage';

export interface NetworkSelection {
  /** Effective network on screen. */
  network: NeuraiNetwork;
  /** The one a tap on the switcher would go to. */
  other: NeuraiNetwork;
  /** Switcher is only offered when both networks have wallets. */
  canSwitch: boolean;
  /** The other network received coins while this one was shown. */
  otherHasUnseen: boolean;
  /** Wallets on `network`, in storage order. */
  visibleWallets: TWallet[];
  setNetwork: (network: NeuraiNetwork) => Promise<void>;
}

export function useNetworkSelection(): NetworkSelection {
  const { wallets } = useStorage();
  const { selectedNetwork, setSelectedNetworkStorage, unseenNetworks } = useSettings();

  const { network, canSwitch } = useMemo(() => resolveNetworkView(selectedNetwork, wallets), [selectedNetwork, wallets]);
  const other = otherNetwork(network);

  const visibleWallets = useMemo(() => wallets.filter(w => walletNetwork(w) === network), [wallets, network]);

  const setNetwork = useCallback(
    (next: NeuraiNetwork) => {
      // Configure before the state change so the list crossfades rather than
      // snapping; the same treatment the total-balance unit toggle uses.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return setSelectedNetworkStorage(next);
    },
    [setSelectedNetworkStorage],
  );

  return {
    network,
    other,
    canSwitch,
    otherHasUnseen: unseenNetworks[other],
    visibleWallets,
    setNetwork,
  };
}

export default useNetworkSelection;
