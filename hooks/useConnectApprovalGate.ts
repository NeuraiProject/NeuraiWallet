/**
 * The unlock every Neurai Connect signature goes through.
 *
 * `useExtendedNavigation`'s `requiresBiometrics` list only gates its own
 * `navigate`, and the approval screens are reached with `replace` (from
 * `ConnectPair`) or with `navigationRef.dispatch` (from `useNeuraiConnect`), so
 * that list never fires for them. Gating the *action* is the right place
 * anyway: what must be protected is producing a signature for a web site, not
 * looking at the request.
 *
 * Same behaviour as the wallet-deletion flow: ask only when the user enabled
 * biometrics, and treat a cancelled prompt as "do not sign".
 */

import { useCallback } from 'react';
import { unlockWithBiometrics, useBiometrics } from './useBiometrics';

export const useConnectApprovalGate = () => {
  const { isBiometricUseCapableAndEnabled } = useBiometrics();

  /** True when the user may proceed; false when they cancelled the prompt. */
  const requireUnlock = useCallback(async (): Promise<boolean> => {
    if (!(await isBiometricUseCapableAndEnabled())) return true;
    return unlockWithBiometrics();
  }, [isBiometricUseCapableAndEnabled]);

  return { requireUnlock };
};
