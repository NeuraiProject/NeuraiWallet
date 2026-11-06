/**
 * Pinned C7 TEST pool instance (same file as the web wallet's
 * `src/privacy-pool/c7-testnet.json`).
 *
 * The manifest, deployment anchor, verifying keys and proving-file hashes are
 * part of the application build and are never taken from an RPC reply or from
 * the server that hosts the proving files.
 *
 * C7 (NeuraiZK/v3 addresses and records) reuses the C6 circuits and proving
 * files; the worker checks that its domain derives from the pinned birth.
 * neurai-privacy 0.4.0 runs C7 only, so the C6 XNA and asset pools are gone.
 */

import type { startC7PoolWorker } from '@neuraiproject/neurai-privacy/worker';

import c7File from './c7-testnet.json';

export type C6PoolKind = 'xna';
export type PoolGeneration = 'C7';

export type C6WorkerConfig = Omit<Parameters<typeof startC7PoolWorker>[0], 'scope' | 'snarkjs' | 'fetchArtifact'> & {
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

const C7_PROFILE = 'C7-XNA-TEST-v1';

/**
 * The testnet web wallet deploys the instance's proving files under the
 * manifest's `artifactBaseUrl` (`/privacy-c7/`). Any HTTPS host works: the
 * app keeps a file only if it matches its pinned size and SHA-256.
 */
export const C6_TESTNET_FILES_ORIGIN = 'https://webwallet-testnet.neurai.org';

function defaultArtifactUrl(config: C6WorkerConfig): string {
  const path = config.artifactBaseUrl ?? '/';
  if (!/^\/[A-Za-z0-9._/-]*\/$/.test(path)) throw new Error('Privacy pool manifest has an invalid artifactBaseUrl');
  return C6_TESTNET_FILES_ORIGIN + path;
}

function runtime(file: ReviewedFile): C6Runtime | null {
  if (file.config.network !== 'testnet') return null;
  if (file.config.deployment.kind !== 'xna') return null;
  if ((file.config.manifest as { profile?: string }).profile !== C7_PROFILE) return null;
  const id = file.config.expectedCommitment;
  return { kind: 'xna', generation: 'C7', id, config: file.config, defaultArtifactUrl: defaultArtifactUrl(file.config) };
}

/** A pinned instance is offered only while its file says `enabled: true`. */
function offered(file: ReviewedFile, instance: C6Runtime | null): C6Runtime | null {
  return file.enabled === true ? instance : null;
}

const C7_FILE = c7File as unknown as ReviewedFile;

/** The pinned C7 instance, offered or not: C7TEST1106A#POOL, born on the testnet restarted on 2026-11-05. */
export const C7_XNA_TESTNET = runtime(C7_FILE);

export type PrivacyPoolId = 'c7';

/** The pools the privacy tab offers. */
export const PRIVACY_POOLS: ReadonlyArray<{ id: PrivacyPoolId; runtime: C6Runtime | null }> = [
  { id: 'c7', runtime: offered(C7_FILE, C7_XNA_TESTNET) },
];

/** Whether any pool is offered; without one, wallets show no privacy tab. */
export const PRIVACY_AVAILABLE = PRIVACY_POOLS.some(pool => pool.runtime !== null);

/** The pool the privacy tab opens with. */
export const DEFAULT_PRIVACY_POOL: PrivacyPoolId = 'c7';
