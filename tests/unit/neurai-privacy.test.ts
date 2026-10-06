// C6 privacy pool plumbing: the WebView bridge and its codec, the file CAS
// store and local locks, the pinned proving-file store, and the wallet adapter.
// The proving worker itself runs in a browser; see privacy-host/e2e.

import { createHash } from 'crypto';
import { C6WorkerClient } from '@neuraiproject/neurai-privacy/client';

import { decodeBridgeMessage, encodeBridgeMessage } from '../../blue_modules/neurai/privacy/codec';
import { PrivacyHostBridge } from '../../blue_modules/neurai/privacy/bridge';
import { shortStage } from '../../blue_modules/neurai/privacy/stages';
import { C6_ASSET_TESTNET, C6_XNA_TESTNET } from '../../blue_modules/neurai/privacy/deployment';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';
import { NeuraiECDSAWallet } from '../../class/wallets/neurai-ecdsa-wallet';
import { c6BlockedReason, c6Family, createPrivacyRpc } from '../../blue_modules/neurai/privacy/wallet';
import { PRIVACY_TX_TAGS_PREFIX, privacyTxKind, tagPrivacyTxs } from '../../blue_modules/neurai/privacy/txTags';
import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory react-native-fs: enough for the store and the proving-file store.
const files = new Map<string, Buffer>();
const downloads: Array<{ fromUrl: string; toFile: string }> = [];
let served: Record<string, Buffer> = {};
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  mkdir: jest.fn(async () => undefined),
  exists: jest.fn(async (path: string) => files.has(path)),
  readFile: jest.fn(async (path: string) => {
    const file = files.get(path);
    if (!file) throw new Error('ENOENT ' + path);
    return file.toString('utf8');
  }),
  writeFile: jest.fn(async (path: string, value: string) => {
    files.set(path, Buffer.from(value, 'utf8'));
  }),
  moveFile: jest.fn(async (from: string, to: string) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  }),
  unlink: jest.fn(async (path: string) => {
    for (const key of [...files.keys()]) if (key === path || key.startsWith(path + '/')) files.delete(key);
  }),
  stat: jest.fn(async (path: string) => {
    const file = files.get(path);
    if (!file) throw new Error('ENOENT ' + path);
    return { isFile: () => true, size: file.length };
  }),
  hash: jest.fn(async (path: string) => createHash('sha256').update(files.get(path)!).digest('hex')),
  read: jest.fn(async (path: string, length: number, position: number) =>
    files
      .get(path)!
      .subarray(position, position + length)
      .toString('base64'),
  ),
  downloadFile: jest.fn((options: { fromUrl: string; toFile: string }) => {
    downloads.push(options);
    const name = decodeURIComponent(options.fromUrl.split('/').pop()!);
    const body = served[name];
    if (body) files.set(options.toFile, body);
    return { jobId: 1, promise: Promise.resolve({ statusCode: body ? 200 : 404, bytesWritten: body?.length ?? 0 }) };
  }),
}));

// eslint-disable-next-line import/first
import { C6ArtifactStore } from '../../blue_modules/neurai/privacy/artifacts';
// eslint-disable-next-line import/first
import { FileCasStore, createLocalLocks } from '../../blue_modules/neurai/privacy/store';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('bridge codec', () => {
  it('round-trips bytes, bigints and plain JSON exactly', () => {
    const message = {
      k: 'from-worker',
      data: {
        packet: Uint8Array.from([0, 1, 254, 255]),
        nested: [{ cm: new Uint8Array(32).fill(7) }],
        amount: 12345678901234567890n,
        buffer: Uint8Array.from([9, 8]).buffer,
        node: Buffer.from('cafe', 'hex'),
        text: 'quote " and   line',
        nothing: null,
      },
    };
    const decoded = decodeBridgeMessage<typeof message>(encodeBridgeMessage(message));
    expect(decoded.data.packet).toEqual(Uint8Array.from([0, 1, 254, 255]));
    expect(decoded.data.packet).toBeInstanceOf(Uint8Array);
    expect(decoded.data.nested[0].cm).toEqual(new Uint8Array(32).fill(7));
    expect(decoded.data.amount).toBe(12345678901234567890n);
    expect(new Uint8Array(decoded.data.buffer as ArrayBuffer)).toEqual(Uint8Array.from([9, 8]));
    // A Node Buffer is a Uint8Array: it must not degrade to {type, data}.
    expect(decoded.data.node).toEqual(Uint8Array.from([0xca, 0xfe]));
    expect(decoded.data.text).toBe(message.data.text);
    expect(decoded.data.nothing).toBeNull();
  });

  it('refuses typed arrays the protocol never carries', () => {
    expect(() => encodeBridgeMessage({ x: new Uint16Array(2) })).toThrow('Unsupported typed array');
  });
});

/** A fake page: records what the app sends and lets the test answer as the page. */
function fakeHost() {
  const sent: any[] = [];
  const bridge = new PrivacyHostBridge({ send: text => sent.push(decodeBridgeMessage(text)) });
  const page = (message: unknown) => bridge.receive(encodeBridgeMessage(message));
  return { bridge, sent, page };
}

describe('privacy host bridge', () => {
  it('queues until the page is ready, then relays worker traffic both ways', async () => {
    const { bridge, sent, page } = fakeHost();
    const worker = bridge.createWorker({ network: 'testnet' }, async () => '');
    worker.postMessage({ type: 'scan' });
    expect(sent).toHaveLength(0);

    page({ k: 'ready' });
    await bridge.whenReady();
    expect(sent.map(m => m.k)).toEqual(['start', 'to-worker']);
    expect(sent[0].config).toEqual({ network: 'testnet' });
    expect(sent[1].data).toEqual({ type: 'scan' });

    const received: unknown[] = [];
    worker.onmessage = event => received.push(event.data);
    page({ k: 'from-worker', ch: sent[0].ch, data: { type: 'prepared', packet: Uint8Array.from([1, 2]) } });
    expect(received).toEqual([{ type: 'prepared', packet: Uint8Array.from([1, 2]) }]);
  });

  it('serves proving files chunk by chunk, with end and error replies', async () => {
    const { bridge, sent, page } = fakeHost();
    page({ k: 'ready' });
    const reads: Array<[string, number, number]> = [];
    bridge.createWorker({}, async (path, offset, length) => {
      reads.push([path, offset, length]);
      if (path === 'missing.zkey') throw new Error('download failed');
      return offset === 0 ? Buffer.from([5, 6, 7]).toString('base64') : '';
    });
    const ch = sent[0].ch;
    page({ k: 'artifact-read', ch, id: 1, path: 'D.zkey', offset: 0, length: 1024 });
    page({ k: 'artifact-read', ch, id: 2, path: 'D.zkey', offset: 3, length: 1024 });
    page({ k: 'artifact-read', ch, id: 3, path: 'missing.zkey', offset: 0, length: 1024 });
    await new Promise(resolve => setImmediate(resolve));
    const chunks = sent.filter(m => m.k === 'artifact-chunk');
    expect(chunks.find(m => m.id === 1).data).toBe(Buffer.from([5, 6, 7]).toString('base64'));
    expect(chunks.find(m => m.id === 2).data).toBeNull();
    expect(chunks.find(m => m.id === 3)).toMatchObject({ data: null, error: 'download failed' });
    expect(reads[0]).toEqual(['D.zkey', 0, 1024]);
  });

  it('reports worker failures and refuses to post to a dead worker', () => {
    const { bridge, sent, page } = fakeHost();
    page({ k: 'ready' });
    const worker = bridge.createWorker({}, async () => '');
    const errors: string[] = [];
    worker.onerror = event => errors.push(event.message);
    page({ k: 'worker-error', ch: sent[0].ch, message: 'C6 worker: pinned instance mismatch' });
    expect(errors).toEqual(['C6 worker: pinned instance mismatch']);
    expect(() => worker.postMessage({ type: 'scan' })).toThrow('terminated');
  });

  it('resolves and rejects helper calls, and fails everything when the page restarts', async () => {
    const { bridge, sent, page } = fakeHost();
    page({ k: 'ready' });
    const ok = bridge.call('c6SponsorWalletId', ['words', '']);
    const bad = bridge.call('openVault', ['{}', 'password']);
    const pendingCall = bridge.call('sealVault', [{}, 'password']);
    const worker = bridge.createWorker({}, async () => '');
    const errors: string[] = [];
    worker.onerror = event => errors.push(event.message);
    const calls = sent.filter(m => m.k === 'call');
    page({ k: 'call-result', id: calls[0].id, result: 'ab'.repeat(32) });
    page({ k: 'call-result', id: calls[1].id, error: 'Wrong password' });
    await expect(ok).resolves.toBe('ab'.repeat(32));
    await expect(bad).rejects.toThrow('Wrong password');

    page({ k: 'ready' }); // the WebView reloaded: its workers and calls are gone
    await expect(pendingCall).rejects.toThrow('restarted');
    expect(errors).toHaveLength(1);
  });

  it('drives the library C6WorkerClient: requests, RPC relay and journal CAS', async () => {
    const { bridge, sent, page } = fakeHost();
    page({ k: 'ready' });
    const store = new Map<string, string>();
    const rpc = jest.fn(async (method: string) => (method === 'getblockcount' ? 25_000 : null));
    const client = new C6WorkerClient({
      worker: bridge.createWorker({}, async () => ''),
      rpc,
      store: {
        read: async (key: string) => store.get(key) ?? null,
        compareAndSwap: async (key: string, expected: string | null, replacement: string) => {
          if ((store.get(key) ?? null) !== expected) return false;
          store.set(key, replacement);
          return true;
        },
      },
    });
    const ch = sent[0].ch;
    const scanning = client.scan();
    expect(sent[sent.length - 1]).toMatchObject({ k: 'to-worker', data: { type: 'scan' } });

    // The worker asks for RPC and storage; the client answers through the bridge.
    page({ k: 'from-worker', ch, data: { type: 'rpc', id: 1, method: 'getblockcount', params: [] } });
    page({ k: 'from-worker', ch, data: { type: 'journal-write', id: 2, key: 'k', expected: null, replacement: 'cipher' } });
    await new Promise(resolve => setImmediate(resolve));
    const replies = sent.filter(m => m.k === 'to-worker').map(m => m.data);
    expect(replies).toContainEqual({ type: 'rpc-result', id: 1, result: 25_000 });
    expect(replies).toContainEqual({ type: 'journal-result', id: 2, result: true });
    expect(store.get('k')).toBe('cipher');

    page({ k: 'from-worker', ch, data: { type: 'scan', result: { balanceAtomic: '0' } } });
    page({ k: 'from-worker', ch, data: { type: 'done' } });
    await expect(scanning).resolves.toEqual({ scan: { type: 'scan', result: { balanceAtomic: '0' } } });
    client.terminate();
    expect(sent[sent.length - 1]).toEqual({ k: 'stop', ch });
  });
});

describe('file CAS store and local locks', () => {
  beforeEach(() => files.clear());

  it('implements read / compareAndSwap like the IndexedDB store', async () => {
    const store = new FileCasStore('c6-private-journal-v1');
    expect(await store.read('neurai:c6:journal')).toBeNull();
    expect(await store.compareAndSwap('neurai:c6:journal', null, 'v1')).toBe(true);
    expect(await store.compareAndSwap('neurai:c6:journal', null, 'v2')).toBe(false);
    expect(await store.compareAndSwap('neurai:c6:journal', 'v1', 'v2')).toBe(true);
    expect(await store.read('neurai:c6:journal')).toBe('v2');
    // Keys never become paths: file names are hashes.
    expect([...files.keys()].every(path => /\/[0-9a-f]{64}$/.test(path))).toBe(true);
  });

  it('serializes concurrent swaps: only one writer wins from the same expected value', async () => {
    const store = new FileCasStore('c6-sponsor-journal-v1');
    const results = await Promise.all([store.compareAndSwap('k', null, 'a'), store.compareAndSwap('k', null, 'b')]);
    expect(results.sort()).toEqual([false, true]);
  });

  it('runs lock callbacks of one name one at a time, even after an error', async () => {
    const locks = createLocalLocks();
    const order: string[] = [];
    const slow = locks.request('flow', { mode: 'exclusive' }, async () => {
      order.push('a:start');
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push('a:end');
      throw new Error('boom');
    });
    const next = locks.request('flow', { mode: 'exclusive' }, async () => {
      order.push('b');
      return 2;
    });
    await expect(slow).rejects.toThrow('boom');
    await expect(next).resolves.toBe(2);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });
});

describe('pinned proving files', () => {
  const runtime = C6_XNA_TESTNET!;
  const pinned = Object.entries(runtime.config.artifacts.files)[0];
  const [name, meta] = pinned as [string, { bytes: number; sha256: string }];

  beforeEach(() => {
    files.clear();
    downloads.length = 0;
    served = {};
  });

  it('pins the C6 XNA and asset instances shipped with the app', () => {
    expect(C6_XNA_TESTNET?.config.manifest.profile).toBe('C6-XNA-TEST-J2-v2');
    expect(C6_ASSET_TESTNET?.config.deployment.kind).toBe('asset');
    for (const instance of [C6_XNA_TESTNET!, C6_ASSET_TESTNET!]) {
      expect(Object.keys(instance.config.artifacts.files)).toHaveLength(18);
    }
    // Served by the testnet web wallet, where the same pinned files are deployed.
    expect(C6_XNA_TESTNET!.defaultArtifactUrl).toBe('https://webwallet-testnet.neurai.org/privacy-c6/');
    expect(C6_ASSET_TESTNET!.defaultArtifactUrl).toBe('https://webwallet-testnet.neurai.org/privacy-c6-assets/C6ASSET261004A/');
  });

  it('keeps a downloaded file only when its size and SHA-256 match the pin', async () => {
    const store = new C6ArtifactStore(runtime);
    // A host serving other bytes of the right size is rejected and nothing is kept.
    served = { [name]: Buffer.alloc(meta.bytes, 1) };
    await expect(store.ensure(name)).rejects.toThrow('pinned hash');
    expect([...files.keys()]).toEqual([]);
    expect(downloads[0].fromUrl).toBe(runtime.defaultArtifactUrl + name);
  });

  it('reads chunks of a verified file and refuses unpinned names', async () => {
    const store = new C6ArtifactStore(runtime);
    const body = Buffer.alloc(meta.bytes, 3);
    // Pretend the pinned hash is this body's hash by placing a verified file directly.
    files.set(`/docs/neurai-privacy/c6/${runtime.id}/${name}`, body);
    const chunk = await store.read(name, 2, 5);
    expect(chunk).toBe(Buffer.alloc(5, 3).toString('base64'));
    expect(await store.read(name, meta.bytes, 5)).toBe('');
    expect(downloads).toHaveLength(0);
    await expect(store.read('../../wallet.json', 0, 5)).rejects.toThrow('Unknown proving file');
    expect((await store.status()).present).toBe(1);
  });
});

describe('wallet adapter', () => {
  it('opens C6 for testnet Legacy, strict ECDSA and strict PQ wallets with words only', () => {
    expect(c6Family(NeuraiHDWallet.forNetwork('testnet', MNEMONIC))).toBe('legacy');
    expect(c6Family(NeuraiECDSAWallet.forNetwork('testnet', MNEMONIC))).toBe('ecdsa');
    expect(c6Family(NeuraiECDSAWallet.forNetwork('mainnet', MNEMONIC))).toBeNull();
    expect(c6Family(NeuraiPQWallet.forNetwork('testnet', MNEMONIC))).toBe('pq');
    expect(c6Family(NeuraiHDWallet.forNetwork('mainnet', MNEMONIC))).toBeNull();
    expect(c6BlockedReason(NeuraiHDWallet.forNetwork('mainnet', MNEMONIC))).toMatch(/testnet/);
    const hardware = new NeuraiHardwareWallet();
    expect(c6Family(hardware)).toBeNull();
    expect(c6BlockedReason(hardware)).toMatch(/recovery words/);
  });

  it('exposes the node error code of a WSS rpc.call failure', async () => {
    const wallet = NeuraiHDWallet.forNetwork('testnet', MNEMONIC);
    const failure = Object.assign(new Error('Missing inputs'), { code: 1005, details: { code: 1005, node_code: -25 } });
    jest.spyOn(wallet, 'getBackend').mockReturnValue({ rpc: jest.fn().mockRejectedValue(failure) } as never);
    const rpc = createPrivacyRpc(wallet);
    await expect(rpc('sendrawtransaction', ['00'])).rejects.toMatchObject({ message: 'Missing inputs', code: -25 });
  });
});

describe('progress labels', () => {
  const labels = {
    syncing: 'Syncing',
    recovering: 'Recovering notes',
    verifyingChain: 'Verifying chain',
    synced: 'Synced to',
    saving: 'Saving history',
    loading: 'Loading',
    witness: 'Computing witness',
    proving: 'Building proof',
    verifyingProof: 'Verifying proof',
  };

  it('shortens the worker stage messages to one line', () => {
    expect(shortStage('Checking pool operation at block 22127 (chain snapshot 25340)', labels)).toBe('Syncing 22127/25340');
    expect(shortStage('Reading C6 block 9 / 25340', labels)).toBe('Syncing 9/25340');
    expect(shortStage('C6 synchronized through block 25483', labels)).toBe('Synced to 25483');
    expect(shortStage('Loading J2.zkey · 45%', labels)).toBe('Loading J2 45%');
    expect(shortStage('Generate D proof', labels)).toBe('Building proof D');
    expect(shortStage('Something new', labels)).toBe('Something new');
  });
});

describe('privacy transaction tags', () => {
  const A = 'aa'.repeat(32);
  const B = 'bb'.repeat(32);
  const C = 'cc'.repeat(32);
  const stored = async (walletId: string) => JSON.parse((await AsyncStorage.getItem(PRIVACY_TX_TAGS_PREFIX + walletId)) ?? 'null');

  it('maps journal actions to list kinds', () => {
    expect(privacyTxKind('deposit')).toBe('deposit');
    expect(privacyTxKind('withdraw')).toBe('withdraw');
    expect(privacyTxKind('transfer')).toBe('other');
    expect(privacyTxKind('join')).toBe('other');
  });

  it('persists valid txids per wallet and ignores the rest', async () => {
    await tagPrivacyTxs('w1', [
      [A, 'deposit'],
      [null, 'withdraw'],
      ['not-a-txid', 'other'],
    ]);
    await tagPrivacyTxs('w1', [[B, 'withdraw']]);
    await tagPrivacyTxs('w2', [[C, 'other']]);
    expect(await stored('w1')).toEqual({ [A]: 'deposit', [B]: 'withdraw' });
    expect(await stored('w2')).toEqual({ [C]: 'other' });
  });

  it('keeps saved tags and drops a damaged entry', async () => {
    await AsyncStorage.setItem(PRIVACY_TX_TAGS_PREFIX + 'w3', JSON.stringify({ [A]: 'withdraw', [B]: 'bogus', short: 'deposit' }));
    await tagPrivacyTxs('w3', [[C, 'deposit']]);
    expect(await stored('w3')).toEqual({ [A]: 'withdraw', [C]: 'deposit' });

    await AsyncStorage.setItem(PRIVACY_TX_TAGS_PREFIX + 'w4', '{damaged');
    await tagPrivacyTxs('w4', [[A, 'other']]);
    expect(await stored('w4')).toEqual({ [A]: 'other' });
  });
});
