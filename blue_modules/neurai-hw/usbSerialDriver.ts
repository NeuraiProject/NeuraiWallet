/**
 * Android USB-serial adapter for the NeuraiHW (ESP32) hardware wallet.
 *
 * Bridges `react-native-usb-serialport-for-android` (mik3y/usb-serial-for-android)
 * to the `IUsbSerialDriver` contract that `@neuraiproject/neurai-sign-esp32`
 * expects. The library owns all protocol logic (256-byte / 8 ms chunked writes,
 * line buffering, JSON parsing, timeouts); this file only moves raw bytes.
 *
 * The native module exchanges data as **hex strings** (both `send` and the
 * `onReceived` payload), so we convert bytes ⇄ hex at the boundary.
 *
 * Android only: iOS does not expose generic USB serial to apps.
 */

import { Platform } from 'react-native';
import { UsbSerialManager, Parity, type Device, type UsbSerial } from 'react-native-usb-serialport-for-android';
import { Buffer } from 'buffer';
import type { IUsbSerialDriver, IUsbSerialPort } from '@neuraiproject/neurai-sign-esp32/react-native';

/** Firmware speaks 115200 baud, 8-N-1. */
const BAUD_RATE = 115200;

/**
 * USB vendor ids that identify a NeuraiHW device or a common CDC/serial bridge.
 * `0x303a` is Espressif (the ESP32-S3 native USB CDC); the rest are USB-UART
 * bridge chips used on other ESP32 boards. Mirrors the library's Web Serial
 * filters.
 */
export const NEURAI_HW_VENDOR_IDS: readonly number[] = [
  0x303a, // Espressif (ESP32-S3 native CDC)
  0x10c4, // Silicon Labs CP210x
  0x1a86, // QinHeng CH340/CH9102
  0x0403, // FTDI
  0x067b, // Prolific PL2303
];

export function isUsbSupported(): boolean {
  return Platform.OS === 'android';
}

function bytesToHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex');
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/** List USB devices that look like a NeuraiHW (filtered by known vendor ids). */
export async function listNeuraiHwDevices(): Promise<Device[]> {
  if (!isUsbSupported()) return [];
  const devices = await UsbSerialManager.list();
  const matches = devices.filter(d => NEURAI_HW_VENDOR_IDS.includes(d.vendorId));
  // If nothing matches the vendor filter but exactly one device is attached,
  // surface it anyway — some boards enumerate with unexpected ids.
  if (matches.length === 0 && devices.length === 1) return devices;
  return matches;
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ensure the app has USB permission for the device. The native call shows the
 * Android permission dialog and resolves to `false` immediately (before the
 * user taps), so we then poll `hasPermission` until the user grants it (or the
 * timeout elapses). This makes the first connect succeed without an error on
 * the initial attempt.
 */
export async function ensureUsbPermission(deviceId: number, timeoutMs = 30000): Promise<boolean> {
  if (!isUsbSupported()) return false;
  if (await UsbSerialManager.hasPermission(deviceId)) return true;

  try {
    if (await UsbSerialManager.tryRequestPermission(deviceId)) return true;
  } catch {
    // fall through to polling — the dialog may still have been shown
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await delay(400);
    if (await UsbSerialManager.hasPermission(deviceId)) return true;
  }
  return false;
}

/**
 * Build an `IUsbSerialDriver` bound to a specific USB device id. Permission for
 * the device must already be granted (see {@link ensureUsbPermission}); the
 * driver only opens the port.
 */
export function createUsbSerialDriver(deviceId: number, options?: { baudRate?: number }): IUsbSerialDriver {
  const baudRate = options?.baudRate ?? BAUD_RATE;

  return {
    async open(): Promise<IUsbSerialPort> {
      if (!isUsbSupported()) {
        throw new Error('USB serial is only available on Android');
      }

      const port: UsbSerial = await UsbSerialManager.open(deviceId, {
        baudRate,
        parity: Parity.None,
        dataBits: 8,
        stopBits: 1,
      });

      return {
        async write(data: Uint8Array): Promise<void> {
          await port.send(bytesToHex(data));
        },
        onReceive(handler: (data: Uint8Array) => void) {
          const subscription = port.onReceived(event => {
            // The native module delivers the payload as a hex string, scoped to
            // this device id.
            if (event.deviceId !== deviceId) return;
            if (!event.data) return;
            handler(hexToBytes(event.data));
          });
          return { remove: () => subscription.remove() };
        },
        async close(): Promise<void> {
          await port.close();
        },
      };
    },
  };
}
