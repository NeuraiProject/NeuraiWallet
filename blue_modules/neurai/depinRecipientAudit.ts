/**
 * Independent audit of the DePIN recipient set.
 *
 * The messaging server supplies the list of addresses a message is encrypted
 * to. `@neuraiproject/neurai-depin-msg` already proves each entry is
 * self-consistent — it hashes the public key and requires it to match the
 * address — so a hostile server cannot pair a real holder's address with its
 * own key.
 *
 * What it can still do is add an address it controls, with a matching key of
 * its own: internally consistent, and a copy of every message. The library
 * cannot catch that, because the list is exactly what it was asked to trust.
 *
 * Whether an address really holds the token is not the server's opinion — it
 * is on-chain data. So it can be checked instead of trusted, and this asks a
 * DIFFERENT node: the app's own default RPC, not the user-configured DePIN
 * endpoint that supplied the list.
 *
 * ## The honest limit
 *
 * Two endpoints only count as two sources when they really are different
 * machines. Out of the box today they are the SAME URL, so the audit reports
 * `independent: false` and claims nothing rather than pretending it verified.
 * It becomes meaningful the moment the DePIN RPC is pointed elsewhere — which
 * is precisely the case where the risk exists.
 *
 * ## Why `listdepinholders` and not the recipients call
 *
 * The auditor is deliberately the cheapest command that answers the question,
 * because that is what keeps the pool of possible auditors wide:
 *
 *   listdepinholders            needs -assetindex only
 *   depingetancestorrecipients  needs -assetindex AND -pubkeyindex (plus a reindex)
 *
 * Asking for the public keys here would restrict auditing to nodes carrying an
 * index most do not, which defeats the point. The keys do not need a second
 * source anyway: an address IS the hash of its public key, so the library
 * checks that binding locally. Splitting it this way, each side answers what
 * it alone can:
 *
 *   the recipients call  -> which key to encrypt to (binding checked locally)
 *   this audit           -> whether that address really holds the token
 */
import { chainFor, getDepinRpcConfig, type NeuraiNetwork } from './index';
import { CHAIN_PARAMS } from './networkConfig';

/** One holder as an independent node reports it. */
interface Holder {
  address: string;
  amount: number;
  /** 1 = active; 0 = blocked or revoked. */
  valid: number;
}

export interface RecipientAudit {
  /** False when the audit could not consult a genuinely different endpoint. */
  independent: boolean;
  /** Endpoint consulted, for the UI and for logs. */
  auditUrl: string;
  /** Addresses the messaging server listed that the independent node does not confirm. */
  unconfirmed: string[];
  /** True when every listed address is a valid holder on the independent node. */
  ok: boolean;
  /** Set when the audit itself could not run (node down, method unavailable…). */
  error?: Error;
}

/** The app's own default RPC for a network — never the DePIN override. */
export function trustedAuditUrl(network: NeuraiNetwork): string {
  return CHAIN_PARAMS[chainFor(network, 'legacy')].defaultRpcUrl;
}

function normalizeUrl(url: string): string {
  return String(url).trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

async function callRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'depin-audit', method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: unknown };
  if (json.error) throw new Error(`${method} failed: ${JSON.stringify(json.error).slice(0, 200)}`);
  return json.result;
}

/**
 * Checks the recipient addresses against an independent node.
 *
 * Never throws for an audit failure: a node being down must not stop a send,
 * it must be reported. The caller decides what to do with `ok` and
 * `independent`.
 *
 * @param params.addresses - Recipient addresses the messaging server supplied
 * @param params.token - DePIN token, `&NAME`
 * @param params.network - Chain the chat runs on
 * @returns What the independent node confirms, and whether it was independent
 */
export async function auditRecipients(params: { addresses: string[]; token: string; network: NeuraiNetwork }): Promise<RecipientAudit> {
  const auditUrl = trustedAuditUrl(params.network);
  const depinUrl = getDepinRpcConfig(params.network).url;

  // Same machine, one source. Saying "verified" here would be a lie.
  if (normalizeUrl(auditUrl) === normalizeUrl(depinUrl)) {
    return { independent: false, auditUrl, unconfirmed: [], ok: false };
  }

  try {
    const holders = (await callRpc(auditUrl, 'listdepinholders', [params.token])) as Holder[] | null;
    const active = new Set((holders ?? []).filter(h => h && h.valid === 1 && h.amount > 0).map(h => h.address));
    const unconfirmed = params.addresses.filter(a => !active.has(a));
    return { independent: true, auditUrl, unconfirmed, ok: unconfirmed.length === 0 };
  } catch (error) {
    // Reported, not thrown: an unreachable auditor is not proof of an attack.
    return { independent: true, auditUrl, unconfirmed: [], ok: false, error: error as Error };
  }
}
