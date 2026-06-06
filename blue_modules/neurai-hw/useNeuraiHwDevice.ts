/**
 * React hook that manages the lifecycle of a NeuraiHW (ESP32) USB connection.
 *
 * Orchestrates: device discovery → USB permission → open transport → expose a
 * connected `NeuraiESP32` instance. All device commands (`getInfo`,
 * `getAddress`, `signTransaction`, …) are called on `device` once `status` is
 * `"connected"`.
 *
 * Android only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createNeuraiESP32OverUsb, type NeuraiESP32 } from '@neuraiproject/neurai-sign-esp32/react-native';
import { createUsbSerialDriver, ensureUsbPermission, isUsbSupported, listNeuraiHwDevices } from './usbSerialDriver';

export type NeuraiHwStatus = 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';

export interface UseNeuraiHwDevice {
  status: NeuraiHwStatus;
  error: string | null;
  /** The connected device, available while `status === 'connected'`. */
  device: NeuraiESP32 | null;
  /** Discover, request permission, and open the first available NeuraiHW. */
  connect: () => Promise<NeuraiESP32 | null>;
  /** Close the connection and reset state. */
  disconnect: () => Promise<void>;
}

export function useNeuraiHwDevice(): UseNeuraiHwDevice {
  const supported = isUsbSupported();
  const [status, setStatus] = useState<NeuraiHwStatus>(supported ? 'idle' : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<NeuraiESP32 | null>(null);
  const [device, setDevice] = useState<NeuraiESP32 | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Best-effort close on unmount.
      deviceRef.current?.disconnect().catch(() => {});
      deviceRef.current = null;
    };
  }, []);

  const disconnect = useCallback(async () => {
    const current = deviceRef.current;
    deviceRef.current = null;
    if (current) {
      try {
        await current.disconnect();
      } catch {
        // ignore — best effort
      }
    }
    if (mounted.current) {
      setDevice(null);
      setStatus(supported ? 'idle' : 'unsupported');
      setError(null);
    }
  }, [supported]);

  const connect = useCallback(async (): Promise<NeuraiESP32 | null> => {
    if (!supported) {
      setStatus('unsupported');
      setError('USB serial is only available on Android');
      return null;
    }

    setStatus('connecting');
    setError(null);

    try {
      const devices = await listNeuraiHwDevices();
      if (devices.length === 0) {
        throw new Error('No NeuraiHW device found. Connect it via USB-C and try again.');
      }

      const target = devices[0];
      const granted = await ensureUsbPermission(target.deviceId);
      if (!granted) {
        throw new Error('USB permission denied. Accept the Android dialog and try again.');
      }

      const driver = createUsbSerialDriver(target.deviceId);
      const esp32 = createNeuraiESP32OverUsb(driver);
      await esp32.connect();

      if (!mounted.current) {
        await esp32.disconnect().catch(() => {});
        return null;
      }

      deviceRef.current = esp32;
      setDevice(esp32);
      setStatus('connected');
      return esp32;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (mounted.current) {
        setStatus('error');
        setError(message);
      }
      return null;
    }
  }, [supported]);

  return { status, error, device, connect, disconnect };
}
