import { useCallback, useEffect, useRef, useState } from 'react';

import type { NeuraiESP32 } from '@neuraiproject/neurai-sign-esp32/react-native';

import { deviceDepinChatIdentity, type DepinChatIdentity, type DepinChatNetwork } from '../blue_modules/neurai/depinChatIdentity';
import { useNeuraiHwDevice } from '../blue_modules/neurai-hw/useNeuraiHwDevice';

export type DepinDeviceIdentityPhase = 'idle' | 'connecting' | 'revealing' | 'ready' | 'error';

export interface UseDepinChatDeviceIdentityResult {
  /** The device-backed identity once revealed, else null. */
  identity: DepinChatIdentity | null;
  phase: DepinDeviceIdentityPhase;
  error: string | null;
  /** The live device, kept connected for later sign/decrypt routing (phase B). */
  device: NeuraiESP32 | null;
  /** Connect to the device and reveal its DePIN identity (one on-device approval). */
  reveal: () => Promise<void>;
  /** Drop the identity + connection (e.g. leaving the chat). */
  reset: () => Promise<void>;
}

/**
 * Device-backed DePIN chat identity for hardware wallets. Instead of deriving
 * the account-100 identity from a mnemonic (which a hardware wallet never
 * exposes — the cause of the infinite chat spinner), it asks the connected
 * NeuraiHW device for it via `getDepinIdentity()`.
 *
 * Requires firmware advertising the `depin_identity` capability and the device
 * unlocked (PIN entered on-device). The connection is held open so a later
 * phase can route `depinSign`/`depinDecrypt` to the same device.
 */
export function useDepinChatDeviceIdentity(params: {
  enabled: boolean;
  network: DepinChatNetwork;
}): UseDepinChatDeviceIdentityResult {
  const { enabled, network } = params;
  const hw = useNeuraiHwDevice();
  const [identity, setIdentity] = useState<DepinChatIdentity | null>(null);
  const [phase, setPhase] = useState<DepinDeviceIdentityPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<NeuraiESP32 | null>(null);

  const reset = useCallback(async () => {
    deviceRef.current = null;
    setIdentity(null);
    setPhase('idle');
    setError(null);
    await hw.disconnect().catch(() => {});
  }, [hw]);

  const reveal = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    setPhase('connecting');
    try {
      const device = await hw.connect();
      if (!device) throw new Error(hw.error || 'Could not connect to the device');
      deviceRef.current = device;

      // Feature-detect: old firmware has no DePIN identity support.
      const { capabilities = [] } = await device.ping();
      if (!capabilities.includes('depin_identity')) {
        throw new Error('This firmware does not support DePIN chat — please update it');
      }

      setPhase('revealing');
      const res = await device.getDepinIdentity(); // device prompts "REVEAL IDENTITY?"
      const built = deviceDepinChatIdentity({
        network,
        address: res.address,
        publicKey: res.pubkey,
        path: res.path,
      });
      setIdentity(built);
      setPhase('ready');
    } catch (e: any) {
      deviceRef.current = null;
      await hw.disconnect().catch(() => {});
      setIdentity(null);
      setError(String(e?.message ?? e ?? 'Failed to read the device DePIN identity'));
      setPhase('error');
    }
  }, [enabled, hw, network]);

  // Tear the connection down if the feature gets disabled (e.g. wallet switch).
  useEffect(() => {
    if (!enabled) {
      void reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { identity, phase, error, device: deviceRef.current, reveal, reset };
}

export default useDepinChatDeviceIdentity;
