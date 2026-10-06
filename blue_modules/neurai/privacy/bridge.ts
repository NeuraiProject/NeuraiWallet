/**
 * App side of the privacy WebView bridge.
 *
 * Transport-agnostic: the WebView component feeds `receive()` with the strings
 * the page posts and provides `send()`; tests drive it with a headless browser.
 * Each pool worker is exposed as a `Worker`-like object, which is what
 * `C6WorkerClient` from `@neuraiproject/neurai-privacy/client` expects.
 */

import { decodeBridgeMessage, encodeBridgeMessage } from './codec';
import type { AppToHostMessage, HostCallName, HostToAppMessage, PoolWorkerConfig } from './protocol';

export interface HostTransport {
  send(text: string): void;
}

/** Returns `length` bytes of a pinned proving file from `offset`, base64-encoded; an empty string at the end. */
export type ArtifactReader = (path: string, offset: number, length: number) => Promise<string>;

type WorkerEventHandler = ((event: { data: unknown }) => void) | null;
type WorkerErrorHandler = ((event: { message: string; preventDefault?: () => void }) => void) | null;

/** The subset of `Worker` used by `C6WorkerClient`. */
export interface BridgedWorker {
  onmessage: WorkerEventHandler;
  onerror: WorkerErrorHandler;
  onmessageerror: WorkerEventHandler;
  postMessage(data: unknown): void;
  terminate(): void;
}

interface Channel {
  worker: BridgedWorker;
  readArtifact: ArtifactReader;
  closed: boolean;
}

let nextChannel = 0;

export class PrivacyHostBridge {
  private ready = false;
  private disposed = false;
  private queue: string[] = [];
  private readonly channels = new Map<string, Channel>();
  private readonly calls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextCall = 0;
  private readyWaiters: Array<() => void> = [];
  private readonly transport: HostTransport;

  constructor(transport: HostTransport) {
    this.transport = transport;
  }

  /** Resolves once the page has loaded its scripts. */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise(resolve => this.readyWaiters.push(resolve));
  }

  /** Feed a string posted by the page. */
  receive(text: string): void {
    if (this.disposed) return;
    let message: HostToAppMessage;
    try {
      message = decodeBridgeMessage<HostToAppMessage>(text);
    } catch {
      return;
    }
    switch (message.k) {
      case 'ready':
        // A second `ready` means the page was reloaded: its workers are gone.
        if (this.ready) this.failAll('The privacy engine restarted; open the private wallet again');
        this.ready = true;
        for (const queued of this.queue.splice(0)) this.transport.send(queued);
        for (const waiter of this.readyWaiters.splice(0)) waiter();
        return;
      case 'from-worker': {
        const channel = this.channels.get(message.ch);
        if (channel && !channel.closed) channel.worker.onmessage?.({ data: message.data });
        return;
      }
      case 'worker-error':
        this.failChannel(message.ch, message.message || 'Privacy worker stopped');
        return;
      case 'artifact-read':
        void this.serveArtifact(message.ch, message.id, message.path, message.offset, message.length);
        return;
      case 'call-result': {
        const call = this.calls.get(message.id);
        if (!call) return;
        this.calls.delete(message.id);
        if (message.error !== undefined) call.reject(new Error(message.error));
        else call.resolve(message.result);
      }
    }
  }

  /** The WebView renderer died: every worker and pending call is lost. */
  crashed(reason = 'The privacy engine stopped'): void {
    this.ready = false;
    this.failAll(reason);
  }

  /** Start a pool worker inside the page. */
  createWorker(config: PoolWorkerConfig, readArtifact: ArtifactReader): BridgedWorker {
    const ch = `c${++nextChannel}`;
    const worker: BridgedWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: (data: unknown) => {
        const channel = this.channels.get(ch);
        if (!channel || channel.closed) throw new Error('Privacy worker terminated');
        this.post({ k: 'to-worker', ch, data });
      },
      terminate: () => {
        const channel = this.channels.get(ch);
        if (!channel || channel.closed) return;
        channel.closed = true;
        this.channels.delete(ch);
        if (!this.disposed) this.post({ k: 'stop', ch });
      },
    };
    this.channels.set(ch, { worker, readArtifact, closed: false });
    this.post({ k: 'start', ch, config });
    return worker;
  }

  /** Run one of the page's helper functions (Argon2id vaults, sponsor wallet id). */
  call<T = unknown>(fn: HostCallName, args: unknown[]): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Privacy engine closed'));
    const id = ++this.nextCall;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ k: 'call', id, fn, args });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.failAll('Privacy engine closed');
    this.disposed = true;
    this.queue = [];
  }

  private post(message: AppToHostMessage): void {
    if (this.disposed) throw new Error('Privacy engine closed');
    const text = encodeBridgeMessage(message);
    if (this.ready) this.transport.send(text);
    else this.queue.push(text);
  }

  private async serveArtifact(ch: string, id: number, path: string, offset: number, length: number): Promise<void> {
    const channel = this.channels.get(ch);
    if (!channel || channel.closed) return;
    let reply: AppToHostMessage;
    try {
      const data = await channel.readArtifact(path, offset, length);
      reply = { k: 'artifact-chunk', ch, id, data: data.length ? data : null };
    } catch (error) {
      reply = { k: 'artifact-chunk', ch, id, data: null, error: error instanceof Error ? error.message : String(error) };
    }
    if (!channel.closed && !this.disposed) this.post(reply);
  }

  private failChannel(ch: string, message: string): void {
    const channel = this.channels.get(ch);
    if (!channel || channel.closed) return;
    channel.closed = true;
    this.channels.delete(ch);
    channel.worker.onerror?.({ message });
  }

  private failAll(message: string): void {
    for (const ch of [...this.channels.keys()]) this.failChannel(ch, message);
    for (const call of this.calls.values()) call.reject(new Error(message));
    this.calls.clear();
  }
}
