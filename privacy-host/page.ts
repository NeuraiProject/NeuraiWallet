/**
 * Page script of the hidden privacy WebView.
 *
 * Relays between the app (`window.ReactNativeWebView` / `injectJavaScript`)
 * and dedicated Web Workers created from the bundled worker source. The page
 * itself does no cryptography, so it stays responsive while a worker proves.
 * It makes no network requests: the CSP forbids them and every proving file
 * comes from the app.
 */

import { base64 } from '@scure/base';

import { decodeBridgeMessage, encodeBridgeMessage } from '../blue_modules/neurai/privacy/codec';
import type { AppToHostMessage, HostToAppMessage } from '../blue_modules/neurai/privacy/protocol';

declare const __PRIVACY_WORKER_SOURCE__: string;

interface HostWindow {
  ReactNativeWebView?: { postMessage(text: string): void };
  __neuraiPrivacyHost?: { receive(text: string): void };
}

const host = window as unknown as HostWindow;
const workerUrl = URL.createObjectURL(new Blob([__PRIVACY_WORKER_SOURCE__], { type: 'text/javascript' }));
const workers = new Map<string, Worker>();
let util: Worker | null = null;

function toApp(message: HostToAppMessage): void {
  host.ReactNativeWebView?.postMessage(encodeBridgeMessage(message));
}

function stopWorker(ch: string, message?: string): void {
  const worker = workers.get(ch);
  if (!worker) return;
  workers.delete(ch);
  worker.terminate();
  if (message !== undefined) toApp({ k: 'worker-error', ch, message });
}

function startWorker(ch: string, config: Record<string, unknown>): void {
  stopWorker(ch);
  const worker = new Worker(workerUrl);
  workers.set(ch, worker);
  worker.onmessage = ({ data }) => {
    if (data?.k === 'pool') toApp({ k: 'from-worker', ch, data: data.data });
    else if (data?.k === 'read') toApp({ k: 'artifact-read', ch, id: data.id, path: data.path, offset: data.offset, length: data.length });
    else if (data?.k === 'fatal') stopWorker(ch, data.message);
  };
  worker.onerror = event => {
    event.preventDefault();
    stopWorker(ch, event.message || 'Privacy worker stopped');
  };
  worker.onmessageerror = () => stopWorker(ch, 'Privacy worker message could not be decoded');
  worker.postMessage({ k: 'init', config });
}

function utilWorker(): Worker {
  if (util) return util;
  const worker = new Worker(workerUrl);
  worker.onmessage = ({ data }) => {
    if (data?.k === 'call-result') toApp({ k: 'call-result', id: data.id, result: data.result, error: data.error });
  };
  util = worker;
  return worker;
}

host.__neuraiPrivacyHost = {
  receive(text: string) {
    let message: AppToHostMessage;
    try {
      message = decodeBridgeMessage<AppToHostMessage>(text);
    } catch {
      return;
    }
    switch (message.k) {
      case 'start':
        startWorker(message.ch, message.config);
        return;
      case 'to-worker':
        workers.get(message.ch)?.postMessage({ k: 'pool', data: message.data });
        return;
      case 'stop':
        stopWorker(message.ch);
        return;
      case 'artifact-chunk': {
        // Decoded here, once: the app relays the base64 it read from disk.
        const bytes = message.data ? base64.decode(message.data) : null;
        const transfer = bytes ? [bytes.buffer as ArrayBuffer] : [];
        workers.get(message.ch)?.postMessage({ k: 'chunk', id: message.id, bytes, error: message.error }, transfer);
        return;
      }
      case 'call':
        utilWorker().postMessage({ k: 'call', id: message.id, fn: message.fn, args: message.args });
    }
  },
};

toApp({ k: 'ready' });
