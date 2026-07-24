import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

import { deriveDepinChatIdentity, type DepinChatIdentity } from '../blue_modules/neurai/depinChatIdentity';

interface UseDepinChatIdentityParams {
  chainType: 'xna' | 'xna-test' | string;
  passphrase: string;
  secret: string;
  supported: boolean;
}

/**
 * Derives the account-100 DePIN identity after navigation animations finish.
 * Seed derivation is intentionally kept off the initial render path.
 */
const useDepinChatIdentity = ({ chainType, passphrase, secret, supported }: UseDepinChatIdentityParams) => {
  const [identity, setIdentity] = useState<DepinChatIdentity | null>(null);

  useEffect(() => {
    if (!supported || !secret) {
      setIdentity(null);
      return;
    }

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      try {
        const derived = deriveDepinChatIdentity({ network: chainType as 'xna' | 'xna-test', mnemonic: secret, passphrase });
        if (!cancelled) setIdentity(derived);
      } catch (error) {
        console.debug('DePINChat: failed to derive chat identity', error);
        if (!cancelled) setIdentity(null);
      }
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [chainType, passphrase, secret, supported]);

  return identity;
};

export default useDepinChatIdentity;
