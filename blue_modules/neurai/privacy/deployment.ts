/**
 * Pinned C6 and C7 TEST pool instances (same files as the web wallet's
 * `src/privacy-pool/c6-*.json` and `c7-testnet.json`).
 *
 * The manifest, deployment anchor, verifying keys and proving-file hashes are
 * part of the application build and are never taken from an RPC reply or from
 * the server that hosts the proving files.
 *
 * C7 (NeuraiZK/v3 addresses and records) runs on the same pool worker and
 * circuits as C6: the worker selects it from the manifest profile and checks
 * that its domain derives from the pinned birth.
 */

import type { startC6PoolWorker } from '@neuraiproject/neurai-privacy/worker';

import xnaFile from './c6-testnet.json';
import assetFile from './c6-assets-testnet.json';
import c7File from './c7-testnet.json';

export type C6PoolKind = 'xna' | 'asset';
export type PoolGeneration = 'C6' | 'C7';

export type C6WorkerConfig = Omit<Parameters<typeof startC6PoolWorker>[0], 'scope' | 'snarkjs' | 'fetchArtifact'> & {
  artifactBaseUrl?: string;
};

export interface C6Runtime {
  kind: C6PoolKind;
  generation: PoolGeneration;
  /** Pool commitment: identifies the instance and its proving files. */
  id: string;
  config: C6WorkerConfig;
  /** Default location of the proving files: the testnet web wallet serves the same pinned files. */
  defaultArtifactUrl: string;
}

type ReviewedFile = { enabled: boolean; testOnly?: boolean; config: C6WorkerConfig };

const PROFILES: Record<PoolGeneration, Record<C6PoolKind, string | null>> = {
  C6: { xna: 'C6-XNA-TEST-J2-v2', asset: 'C6-ORDINARY-ASSET-TEST-J2-v1' },
  C7: { xna: 'C7-XNA-TEST-v1', asset: null },
};

/**
 * The testnet web wallet deploys each instance's proving files under the
 * manifest's `artifactBaseUrl` (e.g. `/privacy-c6/`, `/privacy-c7/`). Any
 * HTTPS host works: the app keeps a file only if it matches its pinned size
 * and SHA-256.
 */
export const C6_TESTNET_FILES_ORIGIN = 'https://webwallet-testnet.neurai.org';

function defaultArtifactUrl(config: C6WorkerConfig): string {
  const path = config.artifactBaseUrl ?? '/';
  if (!/^\/[A-Za-z0-9._/-]*\/$/.test(path)) throw new Error('Privacy pool manifest has an invalid artifactBaseUrl');
  return C6_TESTNET_FILES_ORIGIN + path;
}

function runtime(generation: PoolGeneration, kind: C6PoolKind, file: ReviewedFile): C6Runtime | null {
  if (file.enabled !== true || file.config.network !== 'testnet') return null;
  if (file.config.deployment.kind !== kind) return null;
  if ((file.config.manifest as { profile?: string }).profile !== PROFILES[generation][kind]) return null;
  const id = file.config.expectedCommitment;
  return { kind, generation, id, config: file.config, defaultArtifactUrl: defaultArtifactUrl(file.config) };
}

export const C6_XNA_TESTNET = runtime('C6', 'xna', xnaFile as unknown as ReviewedFile);
export const C6_ASSET_TESTNET = runtime('C6', 'asset', assetFile as unknown as ReviewedFile);
export const C7_XNA_TESTNET = runtime('C7', 'xna', c7File as unknown as ReviewedFile);

export type PrivacyPoolId = 'c7' | 'c6' | 'c6-asset';

/** The pools the privacy tab offers, in order: C7 first, so it opens by default. */
export const PRIVACY_POOLS: ReadonlyArray<{ id: PrivacyPoolId; runtime: C6Runtime | null }> = [
  { id: 'c7', runtime: C7_XNA_TESTNET },
  { id: 'c6', runtime: C6_XNA_TESTNET },
  { id: 'c6-asset', runtime: C6_ASSET_TESTNET },
];

/** The pool the privacy tab opens with: the first one installed (C7 when its instance is pinned). */
export const DEFAULT_PRIVACY_POOL: PrivacyPoolId = PRIVACY_POOLS.find(pool => pool.runtime)?.id ?? 'c6';
