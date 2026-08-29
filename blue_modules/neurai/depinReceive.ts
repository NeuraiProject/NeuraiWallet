/**
 * Authenticated receive under protocol 2.
 *
 * The old call was `depinreceivemsg(token, address, timestamp)` and the node
 * refuses it outright: reading a holder's messages now requires proving control
 * of the address. The proof is a single-use nonce from `depinchallenge`, signed
 * by that address, and it expires in 30 seconds.
 *
 * Each authenticated reply carries a `next_challenge` (valid 300 s), so a poll
 * loop chains them instead of asking for a fresh nonce every page. The chain is
 * strictly SERIAL: a nonce is single-use, so two overlapping reads would spend
 * the same one and the second would be rejected.
 *
 * Everything the protocol requires — verifying the pool signature before
 * decrypting, checking each sender's signature over the recomputed digest,
 * scope and size limits — happens inside `receiveDepinMessages`. This module
 * only owns the chaining and the expiry policy, which is what the app has to
 * get right.
 */
import { receiveDepinMessages, requestDepinChallenge, type DepinIdentity } from './depinMsg';
import { createDepinRpc, type RawRpcCall } from './depinRpcAdapter';

/**
 * A challenge plus when it stops being usable.
 *
 * Stored with an absolute deadline rather than a duration: a poll may sit idle
 * for minutes, and a remaining-seconds value would silently go stale.
 */
export interface ChallengeState {
  challenge: string;
  expiresAtMs: number;
}

/** Discarded this far before the stated expiry, so a slow round trip does not race it. */
const EXPIRY_MARGIN_MS = 5_000;

export function isChallengeUsable(state: ChallengeState | null, nowMs: number = Date.now()): boolean {
  return Boolean(state?.challenge) && nowMs + EXPIRY_MARGIN_MS < (state as ChallengeState).expiresAtMs;
}

export interface DepinReceivePage {
  messages: Array<Record<string, unknown>>;
  hasMore: boolean;
  /** Carry this into the next call; null when the chain has to restart. */
  next: ChallengeState | null;
}

/**
 * Reads one page, obtaining or reusing a challenge as needed.
 *
 * @param params.previous - Challenge carried from the last page, if still valid
 * @returns The page plus the challenge to carry forward
 */
export async function receiveDepinPage(params: {
  call: RawRpcCall;
  identity: DepinIdentity;
  token: string;
  poolPublicKey: string;
  network: string;
  previous?: ChallengeState | null;
  afterHash?: string;
  limit?: number;
  nowMs?: number;
}): Promise<DepinReceivePage> {
  const rpc = createDepinRpc(params.call);
  const now = params.nowMs ?? Date.now();

  // Reuse the chained nonce while it is comfortably valid; otherwise ask for a
  // fresh one. Reusing a spent or expired nonce is rejected by the node, so
  // this is the difference between a working poll and a stalled channel.
  let state: ChallengeState;
  if (isChallengeUsable(params.previous ?? null, now)) {
    state = params.previous as ChallengeState;
  } else {
    const issued = (await requestDepinChallenge({
      rpc,
      identity: params.identity,
      token: params.token,
      poolPublicKey: params.poolPublicKey,
      type: 'receive',
    })) as { challenge: string; expiresIn?: number };
    state = {
      challenge: issued.challenge,
      expiresAtMs: now + (issued.expiresIn ?? 30) * 1000,
    };
  }

  const page = (await receiveDepinMessages({
    rpc,
    identity: params.identity,
    token: params.token,
    challenge: state.challenge,
    poolPublicKey: params.poolPublicKey,
    network: params.network,
    ...(params.afterHash ? { afterHash: params.afterHash } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  })) as {
    messages?: Array<Record<string, unknown>>;
    hasMore?: boolean;
    nextChallenge?: string | null;
    nextExpiresIn?: number | null;
  };

  return {
    messages: page.messages ?? [],
    hasMore: Boolean(page.hasMore),
    next: page.nextChallenge ? { challenge: page.nextChallenge, expiresAtMs: now + (page.nextExpiresIn ?? 300) * 1000 } : null,
  };
}

/** A message whose sender signature verified and that decrypted for this identity. */
export interface DepinPlainMessage {
  hash: string;
  sender: string;
  timestamp: number;
  messageType: 'private' | 'group';
  plaintext: string;
}

/**
 * Keeps the entries that are both authentic and readable.
 *
 * The library reports every entry it saw, with `ok` telling whether the
 * SENDER's signature verified and `plaintext` filled only when this identity
 * was among the recipients. Both conditions matter and they are not the same:
 *
 *   `ok === false` is a message that must never be displayed — an unverifiable
 *   sender, or a protocol-1 leftover the node still holds.
 *
 *   `ok === true` with no plaintext is ordinary group traffic addressed to
 *   other holders. Routine, not an error, and silently skipped.
 *
 * @param entries - `messages` from {@link receiveDepinPage}
 * @returns Only the entries safe to show, in the order received
 */
export function readableMessages(entries: Array<Record<string, unknown>>): DepinPlainMessage[] {
  const out: DepinPlainMessage[] = [];
  for (const entry of entries ?? []) {
    if (!entry || entry.ok !== true) continue;
    const plaintext = entry.plaintext;
    if (typeof plaintext !== 'string' || plaintext.length === 0) continue;
    const meta = (entry.message ?? {}) as { sender?: unknown; timestamp?: unknown; messageType?: unknown };
    const hash = typeof entry.hash === 'string' ? entry.hash : '';
    if (!hash) continue;
    out.push({
      hash,
      sender: typeof meta.sender === 'string' ? meta.sender : '',
      timestamp: typeof meta.timestamp === 'number' ? meta.timestamp : Math.floor(Date.now() / 1000),
      messageType: meta.messageType === 'private' ? 'private' : 'group',
      plaintext,
    });
  }
  return out;
}

/**
 * Turns the node's protocol-2 receive rejections into something actionable.
 *
 * These are not transient RPC noise: they describe a state the wallet is in and
 * cannot poll its way out of, so showing the raw message just leaves the user
 * with a stalled channel and no idea why.
 *
 * @param error - Whatever the poll threw
 * @returns An explanation, or null when the error is not one of these
 */
export function explainDepinReceiveRejection(error: unknown): string | null {
  const text = typeof error === 'string' ? error : String((error as { message?: unknown })?.message ?? error ?? '');

  // The node resolves a holder's key from the chain, so an address that has
  // never spent has nothing to resolve. Receiving stays impossible until it
  // does — no amount of retrying changes it.
  if (/has not revealed its public key/i.test(text)) {
    return 'This address has never sent a transaction, so the network does not know its public key yet and cannot deliver messages to it. Send any amount from this address once, then reopen the chat.';
  }

  // A nonce is single-use and short-lived; the chain restarts by itself, so
  // this only matters if it persists.
  if (/challenge/i.test(text) && /(expired|unknown|already used|invalid)/i.test(text)) {
    return 'The read authorization expired before the node answered. This usually resolves on the next attempt.';
  }

  if (/does not hold|not a holder/i.test(text)) {
    return 'This address does not hold the token, so the pool will not release its messages.';
  }

  return null;
}
