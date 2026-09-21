import { getHistory } from '@neuraiproject/neurai-history-list';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { RpcBackend } from '../../blue_modules/neurai/RpcBackend';
import type { AddressDelta } from '../../blue_modules/neurai/NeuraiBackend';

const mnemonic = 'result pact model attract result puzzle final boss private educate luggage era';

async function history(rows: Array<{ txid: string; satoshis: bigint; assetName?: string }>) {
  const wallet = NeuraiHDWallet.forNetwork('testnet', mnemonic);
  const address = await wallet.getReceiveAddressAsync();
  const deltas: AddressDelta[] = rows.map((row, index) => ({ address, assetName: 'XNA', index, blockindex: 0, height: 1, ...row }));
  const backend = new RpcBackend({ chain: wallet.network, url: 'http://127.0.0.1:19211' });
  jest.spyOn(backend, 'rpc').mockResolvedValue([]);
  jest.spyOn(backend, 'getAddressHistory').mockResolvedValue(deltas);
  jest.spyOn(backend, 'getTipHeight').mockResolvedValue(2);
  jest.spyOn(backend, 'getBlockTimes').mockResolvedValue({ 1: 1000 });
  wallet.setBackend(backend);
  await wallet.fetchTransactions();
  return wallet;
}

it('normalizes mixed numeric/text library results to exact wallet bigint and decimal text', async () => {
  const wallet = await history([
    { txid: 'large', satoshis: 10000000000000001n },
    { txid: 'small', satoshis: 1n },
  ]);
  const items = wallet.getHistoryItems();
  expect(items.find(i => i.transactionId === 'large')?.assets[0]).toEqual({
    assetName: 'XNA',
    satoshis: 10000000000000001n,
    value: '100000000.00000001',
  });
  expect(items.find(i => i.transactionId === 'small')?.assets[0]).toEqual({ assetName: 'XNA', satoshis: 1n, value: '0.00000001' });
  expect(wallet.getTransactions().find(t => t.txid === 'large')?.value).toBe(10000000000000001n);
  expect(() => JSON.stringify(wallet)).not.toThrow();
});

it('aggregates an odd large input and change without losing a satoshi', async () => {
  const wallet = await history([
    { txid: 'spent', satoshis: -10000000000000001n },
    { txid: 'spent', satoshis: 9999999900000000n },
  ]);
  expect(wallet.getHistoryItems()[0].assets[0].satoshis).toBe(-100000001n);
  expect(wallet.getTransactions()[0].value).toBe(-100000001n);
});

it('retains large signed XNA transfers alongside assets using the upstream symmetric fee filter', async () => {
  const wallet = await history([
    { txid: 'asset', satoshis: -10000000000000001n },
    { txid: 'asset', satoshis: -100000001n, assetName: 'TOKEN' },
  ]);
  expect(wallet.getHistoryItems()[0].assets).toEqual([
    { assetName: 'XNA', satoshis: -10000000000000001n, value: '-100000000.00000001' },
    { assetName: 'TOKEN', satoshis: -100000001n, value: '-1.00000001' },
  ]);
});

it('keeps deterministic ordering for transactions in the same block', async () => {
  const wallet = await history([
    { txid: 'a', satoshis: 1n },
    { txid: 'c', satoshis: 1n },
    { txid: 'b', satoshis: 1n },
  ]);
  expect(wallet.getHistoryItems().map(i => i.transactionId)).toEqual(['c', 'b', 'a']);
});

it('rejects an already rounded numeric RPC delta in the published library', () => {
  expect(() =>
    getHistory([
      { satoshis: Number('10000000000000001'), assetName: 'XNA', txid: 'bad', index: 0, blockindex: 0, height: 1, address: 'a' },
    ]),
  ).toThrow('safe integer');
});
