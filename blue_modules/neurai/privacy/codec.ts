/**
 * Text codec for the React Native ⇄ WebView privacy bridge.
 *
 * The bridge only carries strings, but the C6 worker protocol is designed for
 * `postMessage` structured clone: replies carry `Uint8Array` packets and some
 * values are `bigint`. This JSON encoding round-trips those types exactly.
 * Shared by the app and by the WebView page (`privacy-host/`), so it must not
 * depend on React Native or DOM APIs.
 */

import { base64 } from '@scure/base';

const TAG = '\u0000neurai';

type Tagged = { [TAG]: 'u8' | 'ab' | 'big'; v: string };

function replacer(this: unknown, key: string, converted: unknown): unknown {
  // JSON.stringify applies toJSON() before the replacer, which would turn a
  // Node-style Buffer (a Uint8Array) into {type, data}; read the original.
  const value = this && typeof this === 'object' ? (this as Record<string, unknown>)[key] : converted;
  if (typeof value === 'bigint') return { [TAG]: 'big', v: value.toString() };
  if (value instanceof Uint8Array) return { [TAG]: 'u8', v: base64.encode(value) };
  if (value instanceof ArrayBuffer) return { [TAG]: 'ab', v: base64.encode(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    // Other typed arrays never appear in the protocol; refuse rather than corrupt them.
    throw new TypeError('Unsupported typed array in privacy bridge message');
  }
  return converted;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && TAG in (value as object)) {
    const tagged = value as Tagged;
    if (tagged[TAG] === 'big') return BigInt(tagged.v);
    const bytes = base64.decode(tagged.v);
    return tagged[TAG] === 'ab' ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  }
  return value;
}

export function encodeBridgeMessage(message: unknown): string {
  return JSON.stringify(message, replacer);
}

export function decodeBridgeMessage<T = unknown>(text: string): T {
  return JSON.parse(text, reviver) as T;
}
