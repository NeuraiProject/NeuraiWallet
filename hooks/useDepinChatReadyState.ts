import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import type { DepinChatIdentity } from '../blue_modules/neurai/depinChatIdentity';

const READY_STATE_PREFIX = 'depin_ready_';

interface UseDepinChatReadyStateParams {
  identity: DepinChatIdentity | null;
  pubkeyRevealed: boolean | null;
  serverInfo: { enabled?: boolean } | null;
}

/** Persists the most recent live readiness result per dedicated chat address. */
const useDepinChatReadyState = ({ identity, pubkeyRevealed, serverInfo }: UseDepinChatReadyStateParams) => {
  const [lastKnownReady, setLastKnownReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    AsyncStorage.getItem(READY_STATE_PREFIX + identity.address)
      .then(value => {
        if (!cancelled && value != null) setLastKnownReady(value === '1');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [identity]);

  useEffect(() => {
    if (!identity || serverInfo == null || pubkeyRevealed == null) return;
    AsyncStorage.setItem(READY_STATE_PREFIX + identity.address, serverInfo.enabled === true && pubkeyRevealed ? '1' : '0').catch(() => {});
  }, [identity, pubkeyRevealed, serverInfo]);

  return lastKnownReady;
};

export default useDepinChatReadyState;
