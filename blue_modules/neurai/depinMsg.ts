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

/**
 * Normalises a DePIN token to the on-chain spelling the library requires.
 *
 * `@neuraiproject/neurai-depin-msg` >= 3.0.0 validates the token and rejects
 * one without the leading `&` ("DePIN token must start with '&'"). Version
 * 2.2.1 accepted either, and the app carries both spellings around: the asset
 * list uses `&NAME`, while `alternateTokenSpelling` in the chat hook learns
 * whichever form a given node reports.
 *
 * Normalising here rather than at each call site means no future caller can
 * reintroduce the mismatch, and the app keeps being able to hold either form.
 *
 * @param token - Token in either spelling
 * @returns The token with a single leading `&`
 */
export function normalizeDepinToken(token: string): string {
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('DePIN token is required');
  return trimmed.startsWith('&') ? trimmed : `&${trimmed}`;
}

export interface DepinBuildInput {
  /** DePIN token/asset name. Either spelling; normalised to `&NAME` on the way in. */
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

/** Signature-less half of a build: ECIES-encrypt only (for external signers). */
export interface DepinPreimageResult {
  /** The ECIES `encryptedPayload` as hex (feed to the device signer + assemble). */
  encryptedPayloadHex: string;
  messageType: 'private' | 'group';
  /** Wire byte: 0x01 private, 0x02 group. */
  messageTypeByte: number;
  encryptedSize: number;
  recipientCount: number;
}

/** Fields needed to finalize a message once an external signer returns the DER sig. */
export interface DepinAssembleParams {
  token: string;
  senderAddress: string;
  timestamp: number;
  messageType: 'private' | 'group';
  encryptedPayloadHex: string;
}

interface DepinMsgApi {
  buildDepinMessage(input: DepinBuildInput): Promise<DepinBuildResult>;
  /** Encrypt-only (no private key). Pair with a device signer + {@link assembleDepinMessage}. */
  buildDepinPreimage(input: Omit<DepinBuildInput, 'privateKey'>): Promise<DepinPreimageResult>;
  /** Finalize a message from the preimage fields + an external DER signature (hex or bytes). */
  assembleDepinMessage(params: DepinAssembleParams, signature: string | Uint8Array): Promise<DepinBuildResult>;
  decryptDepinReceiveEncryptedPayload(encryptedPayloadHex: string, recipientPrivateKey: string): Promise<string | null>;
  wrapMessageForServer(messageHex: string, serverPubKeyHex: string, senderAddress: string): Promise<DepinServerWrapResult>;
  unwrapMessageFromServer(encryptedHex: string, recipientPrivateKey: string): Promise<string | null>;
  wifToHex(wif: string): Promise<string>;
  isWIF(value: string): boolean;

  // --- Protocol 2 (library >= 3.0.0) ---------------------------------------
  //
  // These carry the rules the app must NOT re-implement: verifying `poolsig`
  // before decoding anything, challenge chaining, and the pubkey-to-address
  // binding of the recipient set. The library is validated against the node's
  // own test vectors; a second implementation here would be a second source of
  // truth for the same consensus-adjacent rules.
  getDepinPoolInfo(params: DepinPoolInfoParams): Promise<DepinPoolInfoResult>;
  createSoftwareIdentity(params: { privateKey: string; network?: string }): Promise<DepinIdentity>;
  requestDepinChallenge(params: DepinChallengeParams): Promise<DepinChallenge>;
  receiveDepinMessages(params: Record<string, unknown>): Promise<DepinReceiveResult>;
  resolveDepinRecipients(params: Record<string, unknown>): Promise<DepinRecipients>;
  buildDepinMessageForPool(params: Record<string, unknown>): Promise<{ encrypted: string; sender: string }>;
  submitDepinMessage(params: Record<string, unknown>): Promise<{ messageHash?: string } | string>;
}

/** How the endpoint's pool key is trusted. See the plan's §4.1 / §4.1.1. */
export type DepinTrust =
  | { mode: 'pinned'; pin: DepinPoolPin }
  | { mode: 'key'; serviceId: string; poolPublicKey: string }
  | { mode: 'tofu'; serviceId: string };

/**
 * What the app persists after a first contact. `tofu` returns it OBSERVED, not
 * authenticated: it is a record of what was seen, not proof of who it was.
 */
export interface DepinPoolPin {
  serviceId: string;
  poolRoot: string;
  poolPublicKey: string;
}

export interface DepinPoolInfoParams {
  rpc: unknown;
  serviceId: string;
  trust: DepinTrust;
  network?: string;
}

export interface DepinPoolInfoResult {
  info: {
    enabled: boolean;
    token: string;
    protocol: number;
    depinpoolpkey: string;
    maxrecipients: number;
    maxmessagesize: number;
    [key: string]: unknown;
  };
  pin: DepinPoolPin;
  trust: DepinTrust;
  fingerprint: string;
}

/**
 * A signer. The software one wraps the wallet key; a hardware one would
 * implement the same three capabilities through the device.
 *
 * Declared as an interface on purpose: it is the extension point that keeps
 * hardware support from becoming a rewrite (plan §7.1).
 */
export interface DepinIdentity {
  address: string;
  publicKey: string;
  signMessage(text: string, context?: unknown): Promise<string>;
  signDigest(digestHex: string, context?: unknown): Promise<string>;
  openReply?(encryptedHex: string): Promise<string | null>;
}

export interface DepinChallengeParams {
  rpc: unknown;
  identity: DepinIdentity;
  token: string;
  poolPublicKey: string;
  type?: 'receive' | 'sections' | 'clear';
}

export interface DepinChallenge {
  challenge: string;
  [key: string]: unknown;
}

export interface DepinReceiveResult {
  messages: Array<Record<string, unknown>>;
  nextChallenge?: string;
  [key: string]: unknown;
}

export interface DepinRecipients {
  recipients: Array<{ address: string; pubkey: string }>;
  truncated?: boolean;
  [key: string]: unknown;
}

function api(): DepinMsgApi {
  const a = (globalThis as { neuraiDepinMsg?: DepinMsgApi }).neuraiDepinMsg;
  if (!a || typeof a.buildDepinMessage !== 'function') {
    throw new Error('neuraiDepinMsg is not loaded — ensure @neuraiproject/neurai-depin-msg is bundled (side-effect import).');
  }
  return a;
}

/** Build, ECIES-encrypt and sign a DePIN message. Returns the hex for `depinsubmitmsg`. */
export const buildDepinMessage = (input: DepinBuildInput): Promise<DepinBuildResult> =>
  api().buildDepinMessage({ ...input, token: normalizeDepinToken(input.token) });

/** ECIES-encrypt only (no private key) → preimage for an external signer (hardware wallet). */
export const buildDepinPreimage = (input: Omit<DepinBuildInput, 'privateKey'>): Promise<DepinPreimageResult> =>
  api().buildDepinPreimage({ ...input, token: normalizeDepinToken(input.token) });

/** Finalize a CDepinMessage from preimage fields + an external DER signature. Returns the hex for `depinsubmitmsg`. */
export const assembleDepinMessage = (params: DepinAssembleParams, signature: string | Uint8Array): Promise<DepinBuildResult> =>
  api().assembleDepinMessage(params, signature);

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

// --- Protocol 2 surface -----------------------------------------------------

/** Pool info, authenticated under an explicit trust mode. Verifies `poolsig`. */
export const getDepinPoolInfo = (params: DepinPoolInfoParams): Promise<DepinPoolInfoResult> => api().getDepinPoolInfo(params);

/** A signer backed by the wallet key. The hardware equivalent goes here later. */
export const createSoftwareIdentity = (params: { privateKey: string; network?: string }): Promise<DepinIdentity> =>
  api().createSoftwareIdentity(params);

/** Single-use nonce proving control of the address. Expires in 30 s. */
export const requestDepinChallenge = (params: DepinChallengeParams): Promise<DepinChallenge> => api().requestDepinChallenge(params);

/** Authenticated read. Verifies the envelope before anything is decrypted. */
export const receiveDepinMessages = (params: Record<string, unknown>): Promise<DepinReceiveResult> => api().receiveDepinMessages(params);

/**
 * The recipient set for a token, authenticated as coming from the pinned
 * service. NOTE: the service remains the trust root for its on-chain
 * correctness — see the plan's §4.1.1 for what that leaves open and the
 * multi-node verification that is meant to close it.
 */
export const resolveDepinRecipients = (params: Record<string, unknown>): Promise<DepinRecipients> => api().resolveDepinRecipients(params);

/** Wrap a serialized message in the ECIES envelope addressed to the pool. */
export const buildDepinMessageForPool = (params: Record<string, unknown>): Promise<{ encrypted: string; sender: string }> =>
  api().buildDepinMessageForPool(params);

/** Submit the wrapped message as `{ sender, encrypted }`. */
export const submitDepinMessage = (params: Record<string, unknown>): Promise<{ messageHash?: string } | string> =>
  api().submitDepinMessage(params);
