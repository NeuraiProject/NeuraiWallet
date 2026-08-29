/**
 * Trusted access to the DePIN pool.
 *
 * Under protocol 2 the node answers `depingetmsginfo` and `depinpoolstats` as
 * `{ body, poolsig }`: the content plus a signature made with the pool key. The
 * catch is that the key used to verify that signature travels INSIDE the same
 * body, so verifying it against itself proves only that the answer is
 * self-consistent — not who produced it. A substituted key comes with a
 * matching signature and passes.
 *
 * The app therefore has to decide, ahead of the answer, which key is
 * legitimate. That is what the pin below is for.
 *
 * ## What this does today, and what it does not
 *
 * TOFU: the key seen on first contact with an endpoint is stored, and any later
 * change is refused rather than silently adopted. That stops an attacker who
 * appears afterwards; it does not stop one who is already there on the first
 * connection, which is why the fingerprint is exposed for the UI to show.
 *
 * The planned replacement is verifying the recipient set against several
 * independent nodes — the holder list is on-chain data, so it can be checked
 * rather than trusted. See the plan's §4.1.1: until that lands, a malicious
 * endpoint can add itself to the recipients and read new messages.
 *
 * ## What is persisted
 *
 * Only `{ serviceId, poolRoot, poolPublicKey }`, keyed by network + normalised
 * URL. Never credentials: they rotate without the endpoint changing and must
 * not reach storage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  decodePlainReply,
  getDepinPoolInfo,
  poolKeyFingerprint,
  verifyDepinReply,
  type DepinPoolInfoResult,
  type DepinPoolPin,
  type DepinTrust,
} from './depinMsg';
import { createDepinRpc, depinServiceId, type RawRpcCall } from './depinRpcAdapter';

const KEY_PREFIX = 'depin_pool_pin_';

/** In-memory mirror so repeated calls in one session skip storage. */
const pins = new Map<string, DepinPoolPin>();

/** Raised when the endpoint answers with a different pool key than the one pinned. */
export class DepinPoolPinMismatchError extends Error {
  readonly serviceId: string;
  readonly expectedFingerprint: string;
  readonly seenFingerprint: string;

  constructor(serviceId: string, expectedFingerprint: string, seenFingerprint: string) {
    super(
      `The DePIN pool key for ${serviceId} changed. This can mean the service was legitimately ` +
        `re-keyed, or that something is impersonating it. Nothing was read or sent. ` +
        `Pinned ${expectedFingerprint}, received ${seenFingerprint}.`,
    );
    this.name = 'DepinPoolPinMismatchError';
    this.serviceId = serviceId;
    this.expectedFingerprint = expectedFingerprint;
    this.seenFingerprint = seenFingerprint;
  }
}

/**
 * Short, comparable form of a pool key, for showing the user.
 *
 * The digest is the library's, not a local abbreviation: the only thing a
 * fingerprint is good for is being read out and compared against what another
 * client shows for the same pool, and two tools that disagree on how to shorten
 * a key make that impossible.
 */
export function poolFingerprint(poolPublicKey: string): string {
  const key = String(poolPublicKey || '');
  if (!key) return key;
  try {
    return poolKeyFingerprint(key);
  } catch {
    // Not a parseable key (an unknown counterpart in a mismatch): show what we
    // have rather than hiding the difference the user is being asked about.
    return key.length < 16 ? key : `${key.slice(0, 8)}…${key.slice(-8)}`;
  }
}

export async function loadPin(serviceId: string): Promise<DepinPoolPin | null> {
  const cached = pins.get(serviceId);
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + serviceId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DepinPoolPin;
    if (!parsed?.poolPublicKey || !parsed?.serviceId) return null;
    pins.set(serviceId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function savePin(pin: DepinPoolPin): Promise<void> {
  pins.set(pin.serviceId, pin);
  try {
    await AsyncStorage.setItem(KEY_PREFIX + pin.serviceId, JSON.stringify(pin));
  } catch {
    // A pin that cannot be persisted still guards this session; losing it only
    // means the next launch re-does TOFU.
  }
}

/** Drops a pin so the next contact re-pins. Only for an explicit user action. */
export async function forgetPin(serviceId: string): Promise<void> {
  pins.delete(serviceId);
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + serviceId);
  } catch {
    /* nothing to undo */
  }
}

export interface VerifiedPool extends DepinPoolInfoResult {
  /** True when this contact created the pin, i.e. the key was accepted on trust. */
  firstContact: boolean;
  /** Short form of the pool key, for the UI to show on first contact. */
  fingerprint: string;
}

/**
 * Fetches `depingetmsginfo`, verifies its `poolsig` and enforces the pin.
 *
 * @param params.call - RPC function bound to the node
 * @param params.network - Chain the wallet is on
 * @param params.url - Endpoint URL, used with the network as the pin's identity
 * @returns The verified pool info plus whether this was a first contact
 * @throws {DepinPoolPinMismatchError} If the endpoint answers with another key
 */
export async function getVerifiedPool(params: { call: RawRpcCall; network: string; url: string }): Promise<VerifiedPool> {
  const serviceId = depinServiceId(params.network, params.url);
  const stored = await loadPin(serviceId);
  const rpc = createDepinRpc(params.call);

  const trust: DepinTrust = stored ? { mode: 'pinned', pin: stored } : { mode: 'tofu', serviceId };

  let result: DepinPoolInfoResult;
  try {
    result = await getDepinPoolInfo({ rpc, serviceId, trust, network: params.network });
  } catch (err) {
    // The library rejects a pinned mismatch; translate it into something the
    // UI can act on, keeping the two fingerprints so the user can compare.
    if (stored && /pin|mismatch|poolPublicKey/i.test(String((err as Error)?.message ?? ''))) {
      throw new DepinPoolPinMismatchError(serviceId, poolFingerprint(stored.poolPublicKey), 'unknown');
    }
    throw err;
  }

  const seenKey = result.pin?.poolPublicKey ?? result.info?.depinpoolpkey ?? '';
  if (stored && seenKey && seenKey !== stored.poolPublicKey) {
    throw new DepinPoolPinMismatchError(serviceId, poolFingerprint(stored.poolPublicKey), poolFingerprint(seenKey));
  }

  if (!stored && result.pin) await savePin(result.pin);

  return {
    ...result,
    firstContact: !stored,
    fingerprint: poolFingerprint(seenKey),
  };
}

/** What `depinpoolstats` reports once its envelope has been verified. */
export interface DepinPoolStats {
  enabled?: boolean;
  token?: string;
  total_messages?: number;
  newest_message?: string;
  oldest_message?: string;
  [key: string]: unknown;
}

/**
 * Reads `depinpoolstats` through its signed envelope.
 *
 * Protocol 2 wrapped this reply too — it now arrives as `{ body, poolsig }`,
 * and the app used to read `total_messages` straight off that object, getting
 * `undefined` every time. The poll's "has the pool moved?" shortcut and the
 * unread marker both hang off that number, so both were silently dead against
 * an updated node.
 *
 * The library has no dedicated flow for this call, so the envelope is verified
 * here with the same primitives its own flows use. The signature binds the pool
 * ROOT token (established against the live testnet node, which does not verify
 * unbound), and only a value branded by the verifier can be decoded.
 *
 * @param params.call - RPC function bound to the node
 * @param params.pool - The verified pool, for the pinned key and root token
 * @returns The decoded stats body
 * @throws If the envelope does not verify against the pinned pool key
 */
export async function getVerifiedPoolStats(params: { call: RawRpcCall; pool: VerifiedPool }): Promise<DepinPoolStats> {
  const reply = await params.call('depinpoolstats', []);
  const verified = verifyDepinReply({
    reply,
    method: 'depinpoolstats',
    token: params.pool.pin?.poolRoot ?? params.pool.info?.token ?? '',
    poolPublicKey: params.pool.info.depinpoolpkey,
  });
  return (decodePlainReply(verified) ?? {}) as DepinPoolStats;
}
