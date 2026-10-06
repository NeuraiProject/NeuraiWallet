/**
 * Pinned C6 TEST pool instances (same files as the web wallet's
 * `src/privacy-pool/c6-*.json`).
 *
 * The manifest, deployment anchor, verifying keys and proving-file hashes are
 * part of the application build and are never taken from an RPC reply or from
 * the server that hosts the proving files.
 */

import type { startC6PoolWorker } from '@neuraiproject/neurai-privacy/worker';

import xnaFile from './c6-testnet.json';
import assetFile from './c6-assets-testnet.json';

export type C6PoolKind = 'xna' | 'asset';

export type C6WorkerConfig = Omit<Parameters<typeof startC6PoolWorker>[0], 'scope' | 'snarkjs' | 'fetchArtifact'> & {
  artifactBaseUrl?: string;
};

export interface C6Runtime {
  kind: C6PoolKind;
  /** Pool commitment: identifies the instance and its proving files. */
  id: string;
  config: C6WorkerConfig;
  /** Default location of the proving files: the testnet web wallet serves the same pinned files. */
  defaultArtifactUrl: string;
}

type ReviewedFile = { enabled: boolean; testOnly?: boolean; config: C6WorkerConfig };

/**
 * The testnet web wallet deploys each instance's proving files under the
 * manifest's `artifactBaseUrl` (e.g. `/privacy-c6/`). Any HTTPS host works:
 * the app keeps a file only if it matches its pinned size and SHA-256.
 */
export const C6_TESTNET_FILES_ORIGIN = 'https://webwallet-testnet.neurai.org';

function defaultArtifactUrl(config: C6WorkerConfig): string {
  const path = config.artifactBaseUrl ?? '/';
  if (!/^\/[A-Za-z0-9._/-]*\/$/.test(path)) throw new Error('C6 manifest has an invalid artifactBaseUrl');
  return C6_TESTNET_FILES_ORIGIN + path;
}

function runtime(kind: C6PoolKind, file: ReviewedFile): C6Runtime | null {
  if (file.enabled !== true || file.config.network !== 'testnet') return null;
  if (file.config.deployment.kind !== kind) return null;
  const id = file.config.expectedCommitment;
  return { kind, id, config: file.config, defaultArtifactUrl: defaultArtifactUrl(file.config) };
}

export const C6_XNA_TESTNET = runtime('xna', xnaFile as unknown as ReviewedFile);
export const C6_ASSET_TESTNET = runtime('asset', assetFile as unknown as ReviewedFile);

export const C6_RUNTIMES: Record<C6PoolKind, C6Runtime | null> = { xna: C6_XNA_TESTNET, asset: C6_ASSET_TESTNET };
