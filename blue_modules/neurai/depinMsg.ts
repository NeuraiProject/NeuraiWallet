/**
 * Typed access to `@neuraiproject/neurai-depin-msg` — the library that builds,
 * encrypts, signs and decrypts Neurai DePIN chat messages (ECIES over
 * secp256k1 + AES-256-GCM, wire-compatible with the Neurai node's
 * `depinsubmitmsg` / `depinreceivemsg`).
 *
 * As of v2.2.0 the library dropped the Web Crypto (`crypto.subtle`) dependency
 * in favour of `@noble/*`, so it runs under Hermes / React Native (it only
 * needs `crypto.getRandomValues`, polyfilled in `index.js` via
 * `react-native-get-random-values`, plus `TextEncoder`/`TextDecoder` from the
 * `text-encoding` polyfill in `shim.js`).
 *
 * The package publishes only a browser IIFE bundle that attaches its API to
 * `globalThis.neuraiDepinMsg` (no ESM named exports), so we import it for its
 * side effect and expose a typed surface here. Cross-validated against the web
 * wallet: messages built here decrypt there and vice versa.
 */

// Side-effect import: runs the IIFE, which sets `globalThis.neuraiDepinMsg`.
import '@neuraiproject/neurai-depin-msg/dist/neurai-depin-msg.js';

export interface DepinBuildInput {
  /** DePIN token/asset name (e.g. `FRANCE` — the `&` is not part of the messaging token). */
  token: string;
  /** Sender's DePIN address. */
  senderAddress: string;
  /** Sender's compressed public key (66 hex chars). */
  senderPubKey: string;
  /** Sender's private key as WIF or 64-hex. */
  privateKey: string;
  /** Unix timestamp (seconds). */
  timestamp: number;
  /** Plaintext message. */
  message: string;
  /** Recipients' compressed public keys (66 hex chars each). */
  recipientPubKeys: string[];
  /** `group` = all token holders; `private` = a single recipient + sender. */
  messageType: 'private' | 'group';
}

export interface DepinBuildResult {
  /** Full serialized CDepinMessage as hex (ready for `depinsubmitmsg`). */
  hex: string;
  /** Display hash (byte-reversed double-SHA256), matches node debug.log. */
  messageHash: string;
  messageHashBytes: string;
  encryptedSize: number;
  recipientCount: number;
  messageType: 'private' | 'group';
}

export interface DepinServerWrapResult {
  sender: string;
  encrypted: string;
}

interface DepinMsgApi {
  buildDepinMessage(input: DepinBuildInput): Promise<DepinBuildResult>;
  decryptDepinReceiveEncryptedPayload(encryptedPayloadHex: string, recipientPrivateKey: string): Promise<string | null>;
  wrapMessageForServer(messageHex: string, serverPubKeyHex: string, senderAddress: string): Promise<DepinServerWrapResult>;
  unwrapMessageFromServer(encryptedHex: string, recipientPrivateKey: string): Promise<string | null>;
  wifToHex(wif: string): Promise<string>;
  isWIF(value: string): boolean;
}

function api(): DepinMsgApi {
  const a = (globalThis as { neuraiDepinMsg?: DepinMsgApi }).neuraiDepinMsg;
  if (!a || typeof a.buildDepinMessage !== 'function') {
    throw new Error('neuraiDepinMsg is not loaded — ensure @neuraiproject/neurai-depin-msg is bundled (side-effect import).');
  }
  return a;
}

/** Build, ECIES-encrypt and sign a DePIN message. Returns the hex for `depinsubmitmsg`. */
export const buildDepinMessage = (input: DepinBuildInput): Promise<DepinBuildResult> => api().buildDepinMessage(input);

/** Decrypt an `encrypted_payload_hex` from `depinreceivemsg`. Returns plaintext or null if not for us / auth fails. */
export const decryptDepinReceiveEncryptedPayload = (encryptedPayloadHex: string, recipientPrivateKey: string): Promise<string | null> =>
  api().decryptDepinReceiveEncryptedPayload(encryptedPayloadHex, recipientPrivateKey);

/** Wrap a message hex for the server's pool public key (server privacy layer). */
export const wrapMessageForServer = (messageHex: string, serverPubKeyHex: string, senderAddress: string): Promise<DepinServerWrapResult> =>
  api().wrapMessageForServer(messageHex, serverPubKeyHex, senderAddress);

/** Decrypt a privacy-wrapped `{ encrypted }` response from `depinreceivemsg`. Returns the inner JSON string. */
export const unwrapMessageFromServer = (encryptedHex: string, recipientPrivateKey: string): Promise<string | null> =>
  api().unwrapMessageFromServer(encryptedHex, recipientPrivateKey);

/** Convert a WIF private key to 64-hex. */
export const wifToHex = (wif: string): Promise<string> => api().wifToHex(wif);

/** Heuristic check whether a string looks like a WIF. */
export const isWIF = (value: string): boolean => api().isWIF(value);
