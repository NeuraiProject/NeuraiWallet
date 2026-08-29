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
import { buildDepinMessageForPool, createSoftwareIdentity, normalizeDepinToken, submitDepinMessage, type DepinIdentity } from './depinMsg';
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
  const truncated = skipped?.noPubKeyComplete === false || skipped?.restrictedComplete === false;
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
