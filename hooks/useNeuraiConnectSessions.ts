/**
 * How many live Neurai Connect sessions a wallet is answering.
 *
 * A session settles with a CAIP-10 account of the wallet that approved it
 * (`bip122:<chain>:<address>`, always a wallet address and never a per-domain
 * identity), so the wallet a session belongs to is the one that owns that
 * address. Logins do not settle sessions, so a wallet that has only signed in
 * somewhere is correctly not counted: the badge means "a site can still ask
 * this wallet for things", which is what a user needs to see on the card.
 */

import { useEffect, useState } from 'react';

import { connectSessions, onConnectSessionsChanged } from '../blue_modules/neurai/connect/client';
import { addressFromCaip10 } from '../screen/connect/logic';
import type { TWallet } from '../class/wallets/types';

export function useNeuraiConnectSessions(wallet?: TWallet): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!wallet) {
      setCount(0);
      return;
    }
    const refresh = (): void => {
      let live = 0;
      for (const session of connectSessions()) {
        const accounts = session.namespaces?.bip122?.accounts ?? [];
        const mine = accounts.some(account => {
          const address = addressFromCaip10(account);
          return address !== undefined && wallet.weOwnAddress(address);
        });
        if (mine) live++;
      }
      setCount(live);
    };
    refresh();
    // Fires on settle, on revoke and when the client finishes starting, which is
    // what makes the badge appear on a cold start rather than after the first change.
    return onConnectSessionsChanged(refresh);
  }, [wallet]);

  return count;
}

export default useNeuraiConnectSessions;
