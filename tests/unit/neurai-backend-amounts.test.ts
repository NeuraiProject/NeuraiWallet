import { RpcBackend } from '../../blue_modules/neurai/RpcBackend';
import { WssBackend } from '../../blue_modules/neurai/WssBackend';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';

const fetchBefore = global.fetch;
const socketBefore = global.WebSocket;
const mnemonic = 'result pact model attract result puzzle final boss private educate luggage era';

afterEach(() => {
  global.fetch = fetchBefore;
  global.WebSocket = socketBefore;
});

it('reads raw HTTP integers losslessly, including negative deltas and mempool', async () => {
  const replies: Record<string, string> = {
    getaddressbalance: '{"balance":10000000000000001,"received":10000000000000001}',
    getaddressutxos: '[{"satoshis":10000000000000001}]',
    getaddressdeltas: '[{"satoshis":-10000000000000001}]',
    getaddressmempool: '[{"satoshis":-9007199254740993}]',
  };
  global.fetch = jest.fn(async (_url, options) => {
    const method = JSON.parse(String(options?.body)).method;
    return new Response('{"result":' + replies[method] + ',"error":null,"id":1}', { status: 200 });
  });
  const backend = new RpcBackend({ chain: 'xna-test', url: 'http://127.0.0.1:19211' });
  expect(await backend.getBalance(['a'])).toBe(10000000000000001n);
  expect((await backend.getUtxos(['a']))[0].satoshis).toBe(10000000000000001n);
  expect((await backend.getAddressHistory(['a']))[0].satoshis).toBe(-10000000000000001n);
  expect((await backend.getMempool(['a']))[0].satoshis).toBe(-9007199254740993n);
});

it('routes every engine RPC call through the current selected backend', async () => {
  const w = NeuraiHDWallet.forNetwork('testnet', mnemonic);
  const first = new RpcBackend({ chain: 'xna-test', url: 'http://127.0.0.1:19211' });
  const second = new RpcBackend({ chain: 'xna-test', url: 'http://127.0.0.1:19212' });
  const a = jest.spyOn(first, 'rpc').mockResolvedValue([]);
  const b = jest.spyOn(second, 'rpc').mockResolvedValue([]);
  global.fetch = jest.fn(() => {
    throw new Error('Unexpected external request');
  });
  w.setBackend(first);
  const engine = await (w as any).ensureEngine();
  await engine.rpc('getaddressutxos', [{ addresses: ['a'] }, true]);
  expect(a).toHaveBeenCalledWith('getaddressutxos', [{ addresses: ['a'] }, true]);
  w.setBackend(second);
  await engine.rpc('getaddressmempool', [{ addresses: ['a'] }]);
  expect(b).toHaveBeenCalledWith('getaddressmempool', [{ addresses: ['a'] }]);
  expect(global.fetch).not.toHaveBeenCalled();
});

function service(version: 1 | 2, amount: string, confirmExact = true) {
  const methods: string[] = [];
  let socket: any;
  class FakeSocket {
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    constructor() {
      // Keep the transport instance so the test can deliver server pushes.
      // eslint-disable-next-line consistent-this
      socket = this;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(data: string) {
      const request = JSON.parse(data);
      methods.push(request.method + ':' + (request.params.protocol ?? ''));
      let result: unknown;
      let error: unknown;
      if (request.method === 'hello') {
        if (version === 1 && request.params.protocol === 'wss/2') error = { code: 1001, message: 'Unsupported protocol' };
        else result = { protocol: `wss/${version}`, exact_amounts: confirmExact, amounts: 'string-sats' };
      } else if (request.method === 'address.get_state') {
        result = {
          balance: { confirmed: amount, unconfirmed: '-1' },
          history: [{ txid: 'tx', height: 1, satoshis: '-' + amount }],
          utxos: [{ txid: 'tx', vout: 0, satoshis: amount }],
          mempool: [{ txid: 'pending', satoshis: '-1' }],
        };
      } else if (request.method === 'address.subscribe.bulk') {
        result = { results: [{ address: 'a', status: 'initial', balance: { confirmed: amount, unconfirmed: '-1' } }] };
      }
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result, error }) }));
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  global.WebSocket = FakeSocket as any;
  return {
    methods,
    push: (params: unknown) => socket.onmessage({ data: JSON.stringify({ method: 'address.changed', params }) }),
    close: () => socket?.close(),
  };
}

it('negotiates exact WSS amounts before concurrent requests and normalizes subscriptions and pushes', async () => {
  const server = service(2, '10000000000000001');
  const backend = new WssBackend({ chain: 'xna-test', url: 'ws://local/push' });
  const listener = jest.fn();
  backend.onAddressChanged(listener);
  try {
    await backend.setSubscribedAddresses(['a']);
    expect(listener.mock.calls[0][0].balance).toEqual({ confirmed: 10000000000000001n, unconfirmed: -1n });
    const [balance, history, utxos, mempool] = await Promise.all([
      backend.getBalance(['a']),
      backend.getAddressHistory(['a']),
      backend.getUtxos(['a']),
      backend.getMempool(['a']),
    ]);
    expect(balance).toBe(10000000000000001n);
    expect(history[0].satoshis).toBe(-10000000000000001n);
    expect(utxos[0].satoshis).toBe(balance);
    expect(mempool[0].satoshis).toBe(-1n);
    server.push({ address: 'a', status: 'next', balance: { confirmed: '9007199254740993', unconfirmed: '-300000' } });
    expect(listener.mock.calls[1][0].balance).toEqual({ confirmed: 9007199254740993n, unconfirmed: -300000n });
  } finally {
    server.close();
  }
});

test.each([
  ['100000001', false],
  ['9007199254740993', true],
])('keeps v1 safe balances compatible and blocks unsafe balance %s', async (amount, fails) => {
  const server = service(1, amount);
  const backend = new WssBackend({ chain: 'xna-test', url: 'ws://local/push' });
  try {
    const balance = backend.getBalance(['a']);
    if (fails) await expect(balance).rejects.toThrow('wss/2');
    else expect(await balance).toBe(BigInt(amount));
    expect(server.methods.slice(0, 2)).toEqual(['hello:wss/2', 'hello:wss/1']);
    await expect(backend.rpc('getaddressutxos', [])).rejects.toThrow('paired');
  } finally {
    server.close();
  }
});

it('rejects v2 without exactness capability', async () => {
  const server = service(2, '1', false);
  try {
    await expect(new WssBackend({ chain: 'xna-test', url: 'ws://local/push' }).getBalance(['a'])).rejects.toThrow('confirm exact');
  } finally {
    server.close();
  }
});
