/**
 * With a single selected WSS service, recipient data has no independent source.
 * Signature/public-key verification remains in the DePIN library. Never claim
 * an independent audit or silently query a second HTTP endpoint.
 */
import { getDepinRpcConfig, type NeuraiNetwork } from './index';

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

export function trustedAuditUrl(network: NeuraiNetwork): string {
  return getDepinRpcConfig(network).url;
}

export async function auditRecipients(params: { addresses: string[]; token: string; network: NeuraiNetwork }): Promise<RecipientAudit> {
  return { independent: false, auditUrl: trustedAuditUrl(params.network), unconfirmed: [], ok: false };
}
