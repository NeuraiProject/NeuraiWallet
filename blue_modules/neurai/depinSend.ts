/**
 * Sending a DePIN message under protocol 2.
 *
 * Replaces the hand-rolled assembly the app used to do — fetch each recipient's
 * key with `getpubkey`, build, wrap, submit — with the library calls that carry
 * the protocol's checks:
 *
 *   `buildDepinMessageForPool` resolves the recipient set through the pool and
 *   REFUSES any entry whose public key does not hash to its address. The old
 *   `getpubkey` path accepted whatever the server answered, so a hostile
 *   endpoint could hand back its own key for a real holder's address and read
 *   the message. That check is the reason this path exists.
 *
 *   `submitDepinMessage` wraps the message for the pool, submits it, and
 *   verifies the confirmation's `poolsig` before opening it. The node refuses a
 *   bare hex payload outright, so wrapping is not optional.
 *
 * What remains outside the library's reach is whether a listed address really
 * holds the token: that is on-chain data, checked separately and independently
 * by `depinRecipientAudit`.
 */
import {
  buildDepinMessage,
  buildDepinMessageForPool,
  createSoftwareIdentity,
  decodeDepinRecipients,
  decodePlainReply,
  normalizeDepinToken,
  submitDepinMessage,
  verifyDepinReply,
  type DepinIdentity,
} from './depinMsg';
import { createDepinRpc, type RawRpcCall } from './depinRpcAdapter';
import type { VerifiedPool } from './depinPool';

export interface DepinSendResult {
  /** Hash the pool assigned to the message, for deduplication and receipts. */
  messageHash: string;
  /** How many recipients the message was encrypted to, sender included. */
  recipientCount: number;
  /** True when the pool reported more eligible recipients than it returned. */
  truncated: boolean;
}

/**
 * Builds a signer backed by the wallet key.
 *
 * The return type is the shared {@link DepinIdentity}, not a software-specific
 * one: a hardware signer implements the same three capabilities, so the send
 * path below never learns which kind it holds.
 *
 * @param privateKey - WIF or 64-hex private key of the DePIN identity address
 * @param network - Chain, needed to derive the address the same way the node does
 */
export function softwareIdentity(privateKey: string, network: string): Promise<DepinIdentity> {
  return createSoftwareIdentity({ privateKey, network });
}

/**
 * Sends a group message to every holder of a token.
 *
 * @throws If the pool reports a truncated recipient set. A truncated list is
 *   not a smaller group — it is an unknown one, and encrypting to it would
 *   silently exclude holders who should have received the message.
 */
export async function sendDepinGroupMessage(params: {
  call: RawRpcCall;
  pool: VerifiedPool;
  identity: DepinIdentity;
  token: string;
  message: string;
  timestamp: number;
  network: string;
}): Promise<DepinSendResult> {
  const rpc = createDepinRpc(params.call);
  const token = normalizeDepinToken(params.token);
  const poolPublicKey = params.pool.info.depinpoolpkey;

  const built = await buildDepinMessageForPool({
    rpc,
    token,
    poolRoot: normalizeDepinToken(params.pool.info.token),
    maxRecipients: params.pool.info.maxrecipients,
    poolPublicKey,
    network: params.network,
    identity: params.identity,
    message: params.message,
    timestamp: params.timestamp,
    messageType: 'group',
  });

  const skipped = built.resolution?.skipped;
  // `null` is not permission either: it means the pool did not say whether the
  // skip accounting was complete, which is the same unknown group as `false`.
  const truncated = skipped ? skipped.noPubKeyComplete !== true || skipped.restrictedComplete !== true : false;
  if (truncated) {
    throw new Error(
      'The pool returned a truncated recipient list, so some holders of this token would silently ' + 'miss the message. Nothing was sent.',
    );
  }

  const receipt = await submitDepinMessage({
    rpc,
    identity: params.identity,
    messageHex: built.hex,
    poolPublicKey,
  });

  return {
    messageHash: (typeof receipt === 'object' && receipt?.messageHash) || built.messageHash,
    recipientCount: built.recipientCount ?? 0,
    truncated: false,
  };
}

/** One holder of the token, with a public key verified against it. */
export interface VerifiedRecipient {
  address: string;
  pubkey: string;
}

/**
 * The token's holders with their public keys, verified.
 *
 * Runs the library's own pipeline, composed from its published pieces: verify
 * the `poolsig`, decode only what the verifier branded, then hand the body to
 * `decodeDepinRecipients`, which throws on a truncated list, a scope mismatch,
 * or any key that does not hash to the address offered for it. Only then are the
 * `{address, pubkey}` pairs read from that same body, so they are not the
 * server's word but what the library just finished checking.
 *
 * `resolveDepinRecipients` does exactly this but surfaces the keys without their
 * addresses, which is why the pipeline is assembled here.
 */
export async function verifiedRecipients(params: {
  call: RawRpcCall;
  pool: VerifiedPool;
  token: string;
  senderPubKey: string;
  network: string;
}): Promise<VerifiedRecipient[]> {
  const rpc = createDepinRpc(params.call);
  const token = normalizeDepinToken(params.token);
  const poolRoot = normalizeDepinToken(params.pool.info.token);
  const maxRecipients = params.pool.info.maxrecipients;

  // One above the limit, so "at the limit" and "over it" stay distinct.
  const reply = await rpc.call('depingetancestorrecipients', [token, maxRecipients + 1, poolRoot]);
  const branded = verifyDepinReply({
    reply,
    method: 'depingetancestorrecipients',
    token,
    poolPublicKey: params.pool.info.depinpoolpkey,
  });
  const body = decodePlainReply(branded) as { recipients?: Array<{ address?: unknown; pubkey?: unknown }> };

  await decodeDepinRecipients(body, {
    token,
    poolRoot,
    maxRecipients,
    senderPubKey: params.senderPubKey,
    network: params.network,
  });

  const pairs: VerifiedRecipient[] = [];
  for (const entry of body.recipients ?? []) {
    if (typeof entry?.address === 'string' && typeof entry?.pubkey === 'string') {
      pairs.push({ address: entry.address, pubkey: entry.pubkey });
    }
  }
  return pairs;
}

/**
 * Sends a message to one holder only.
 *
 * Encrypted to exactly two keys, the recipient's and the sender's — the library
 * adds the sender's itself, so only the recipient's is passed. Leaving the
 * sender out would mean the sender could never read their own message back from
 * the pool on another device.
 *
 * The recipient's key is resolved HERE from the pool's verified list rather than
 * accepted from the caller: a caller-supplied key is exactly the substitution
 * the pubkey-to-address check exists to prevent.
 *
 * The plaintext carries a `@<address> ` tag so the sender can place the message
 * in the right conversation from any device. The envelope names the sender only,
 * never the recipient, so without the tag a sender's own messages are
 * unplaceable anywhere their local bookkeeping is missing.
 */
export async function sendDepinPrivateMessage(params: {
  call: RawRpcCall;
  pool: VerifiedPool;
  identity: DepinIdentity;
  token: string;
  toAddress: string;
  message: string;
  timestamp: number;
  network: string;
  senderPubKey: string;
  /** WIF of the chat identity. Software wallets only; a device signs instead. */
  privateKey: string;
}): Promise<DepinSendResult> {
  const rpc = createDepinRpc(params.call);
  const token = normalizeDepinToken(params.token);
  const poolPublicKey = params.pool.info.depinpoolpkey;

  const pairs = await verifiedRecipients({
    call: params.call,
    pool: params.pool,
    token,
    senderPubKey: params.senderPubKey,
    network: params.network,
  });
  const match = pairs.find(entry => entry.address === params.toAddress);
  if (!match) {
    throw new Error(`${params.toAddress} is not a holder of ${token} with a published public key, so nothing can be encrypted to it.`);
  }

  const built = await buildDepinMessage({
    token,
    senderAddress: params.identity.address,
    senderPubKey: params.senderPubKey,
    privateKey: params.privateKey,
    timestamp: params.timestamp,
    message: `@${params.toAddress} ${params.message}`,
    recipientPubKeys: [match.pubkey],
    messageType: 'private',
  });

  const receipt = await submitDepinMessage({
    rpc,
    identity: params.identity,
    messageHex: built.hex,
    poolPublicKey,
  });

  return {
    messageHash: (typeof receipt === 'object' && receipt?.messageHash) || built.messageHash,
    recipientCount: built.recipientCount ?? 2,
    truncated: false,
  };
}
