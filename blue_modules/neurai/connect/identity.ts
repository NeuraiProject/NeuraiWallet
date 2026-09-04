/**
 * Per-domain identity addresses for "Sign in with Neurai".
 *
 * A site that only needs to know who you are gets an address derived from the
 * domain it serves (`m/44'/coin'/101'/0/<index>`, spec/auth.md section 8): the
 * same seed and the same domain always give the same address, two sites cannot
 * correlate the user, and the address holds no funds and no history. A site
 * that needs to look at the chain (a swap, balance gating) asks for a wallet
 * address instead.
 *
 * Account 100 is already the DePIN chat identity, so Connect uses 101. The
 * derivation is BIP44, which post-quantum wallets do not have, so PQ wallets
 * always sign with a wallet address.
 */

import { getAddressByPath, getCoinType, getHDKey } from '@neuraiproject/neurai-key';
import { IdentityRegistry, canonicalDomain, identityIndexForDomain, identityPathForDomain } from '@neuraiproject/neurai-connect-wallet';
import type { AbstractNeuraiWallet } from '../../../class/wallets/abstract-neurai-wallet';
import type { NeuraiChainType } from '../networkConfig';
import { SecureConnectStorage } from './storage';

export { canonicalDomain, identityIndexForDomain, identityPathForDomain };

export interface DomainIdentity {
  address: string;
  path: string;
  publicKey: string;
  /** Canonical form of the domain the identity belongs to. */
  domain: string;
  index: number;
}

/** Chains whose identity addresses can be derived: BIP44 legacy networks only. */
export function supportsDomainIdentity(chain: string): chain is Extract<NeuraiChainType, 'xna' | 'xna-test'> {
  return chain === 'xna' || chain === 'xna-test';
}

const registry = new IdentityRegistry(new SecureConnectStorage());

/** The shared registry of used identities. It must be part of the application backup. */
export function identityRegistry(): IdentityRegistry {
  return registry;
}

/**
 * Derives the identity address of `domain` for a wallet. Returns undefined when
 * the wallet cannot have one (post-quantum, hardware, or no mnemonic).
 *
 * Deriving records nothing: opening a login screen and then rejecting it, or
 * choosing the wallet address instead, must not leave a used identity behind.
 * Call `recordDomainIdentity` once the user has actually signed with it.
 */
export async function deriveDomainIdentity(wallet: AbstractNeuraiWallet, domain: string): Promise<DomainIdentity | undefined> {
  const chain = wallet.network as NeuraiChainType;
  if (!supportsDomainIdentity(chain)) return undefined;
  const mnemonic = wallet.secret;
  if (!mnemonic) return undefined;

  const canonical = canonicalDomain(domain);
  const coinType = getCoinType(chain);
  const path = identityPathForDomain(canonical, coinType);
  const hdKey = getHDKey(chain, mnemonic, wallet.passphrase || undefined);
  const derived = getAddressByPath(chain, hdKey, path);
  return { address: derived.address, path, publicKey: derived.publicKey, domain: canonical, index: identityIndexForDomain(canonical) };
}

/**
 * Records that an identity was used to sign in. The list feeds the login
 * history, lets the wallet watch funds sent to those addresses by mistake, and
 * is part of the application backup: the indexes are sparse, so a normal BIP44
 * scan would not find them again after a restore.
 */
export async function recordDomainIdentity(identity: DomainIdentity): Promise<void> {
  // The coin type is already in the path (m/44'/<coin>'/101'/0/<index>), so the caller
  // does not have to narrow the chain type again just to record what it derived.
  const coinType = Number(identity.path.split('/')[2]?.replace("'", '') ?? 1900);
  await registry.record(identity.domain, identity.address, Number.isFinite(coinType) ? coinType : 1900);
}

/** Identities this wallet has already used, newest first. For the login history screen. */
export async function usedIdentities() {
  const all = await registry.list();
  return all.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}
