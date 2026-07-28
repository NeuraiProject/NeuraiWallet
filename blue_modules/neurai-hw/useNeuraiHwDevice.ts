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

import { withDevice } from './deviceQueue';
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

export interface UseNeuraiHwDeviceOptions {
  /**
   * Leave the USB link open when this hook unmounts. Off by default: a signing
   * or pairing screen is done with the device when it goes away. The DePIN chat
   * opts in, because its screen mounts and unmounts as the user navigates and
   * reconnecting each time would mean another permission prompt and another
   * on-device approval. The caller then owns closing it (`disconnect`).
   */
  keepAliveOnUnmount?: boolean;
}

/**
 * The one open link to the device, shared by every consumer. Only one handle to
 * a USB serial port can be used safely: a second `connect()` while the DePIN
 * chat holds the port would either fail or interleave traffic with signing.
 */
const sharedDevice: { current: NeuraiESP32 | null } = { current: null };

export function useNeuraiHwDevice(options: UseNeuraiHwDeviceOptions = {}): UseNeuraiHwDevice {
  const { keepAliveOnUnmount = false } = options;
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
      if (keepAliveOnUnmount) return; // caller keeps the link and closes it itself
      // The link is shared: closing it here would cut off whoever else is still
      // using it (the DePIN chat holds one across navigation). Only drop our
      // reference; the port closes on an explicit `disconnect` or when the
      // device stops answering.
      if (deviceRef.current && deviceRef.current === sharedDevice.current) {
        deviceRef.current = null;
        return;
      }
      deviceRef.current?.disconnect().catch(() => {});
      deviceRef.current = null;
    };
  }, [keepAliveOnUnmount]);

  const disconnect = useCallback(async () => {
    const current = deviceRef.current;
    deviceRef.current = null;
    if (sharedDevice.current === current) sharedDevice.current = null;
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

    // Reuse a link another screen already opened, if it still answers.
    if (sharedDevice.current) {
      try {
        await withDevice(() => sharedDevice.current!.ping());
        deviceRef.current = sharedDevice.current;
        setDevice(sharedDevice.current);
        setStatus('connected');
        return sharedDevice.current;
      } catch {
        sharedDevice.current = null; // stale — fall through and open a fresh one
      }
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
      sharedDevice.current = esp32;
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
