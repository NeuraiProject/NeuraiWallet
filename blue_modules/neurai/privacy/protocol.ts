/**
 * Messages between the app and the hidden privacy WebView (`privacy-host/`).
 *
 * Hermes has no WebAssembly, so the C6 proving worker of
 * `@neuraiproject/neurai-privacy` (snarkjs witness generation and Groth16) runs
 * in a dedicated Web Worker inside a WebView. The app keeps the worker's
 * client, storage, RPC and signing; this protocol only relays the worker's own
 * messages, the proving files it asks for and a few slow helper calls.
 *
 * Shared by both sides: keep it free of React Native and DOM dependencies.
 */

/** Pool worker configuration: `startC6PoolWorker` options without scope, snarkjs or artifact access. */
export type PoolWorkerConfig = Record<string, unknown>;

/** Helpers that run in the WebView because they use Argon2id (64 MiB) or long PBKDF2. */
export type HostCallName = 'c6SponsorWalletId' | 'sealVault' | 'openVault';

export type AppToHostMessage =
  /** Create the pool worker of channel `ch`. */
  | { k: 'start'; ch: string; config: PoolWorkerConfig }
  /** A message for the pool worker (what `Worker.postMessage` would carry). */
  | { k: 'to-worker'; ch: string; data: unknown }
  | { k: 'stop'; ch: string }
  /**
   * Answer to `artifact-read`: the next chunk as base64 (as the file is read
   * from disk, so the app never decodes it), `null` at the end, or an error.
   */
  | { k: 'artifact-chunk'; ch: string; id: number; data: string | null; error?: string }
  | { k: 'call'; id: number; fn: HostCallName; args: unknown[] };

export type HostToAppMessage =
  | { k: 'ready' }
  /** A message from the pool worker (what `Worker.onmessage` would receive). */
  | { k: 'from-worker'; ch: string; data: unknown }
  /** The pool worker stopped (startup error, uncaught exception or crash). */
  | { k: 'worker-error'; ch: string; message: string }
  /** The pool worker needs `length` bytes of the pinned file `path` from `offset`. */
  | { k: 'artifact-read'; ch: string; id: number; path: string; offset: number; length: number }
  | { k: 'call-result'; id: number; result?: unknown; error?: string };

/** Bytes per artifact chunk crossing the bridge (base64 grows it by a third). */
export const ARTIFACT_CHUNK_BYTES = 2 * 1024 * 1024;
