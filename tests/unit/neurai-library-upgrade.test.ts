import { bech32m } from 'bech32';
import { getPQAddress } from '@neuraiproject/neurai-key';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import fixtures from './fixtures/neurai-key4-addresses.json';

// Generated from the previous published jswallet 0.15.3 with key 4.0.1.
// These literals must not be regenerated merely to make an incompatible upgrade pass.
type Fixture = (typeof fixtures.fixtures)[number];
const fixture = (network: string): Fixture => fixtures.fixtures.find(f => f.network === network)!;

async function restoredAddresses(Constructor: typeof NeuraiHDWallet | typeof NeuraiPQWallet, network: 'mainnet' | 'testnet') {
  const wallet = Constructor.forNetwork(network, fixtures.mnemonic);
  wallet.addressPosition = 1;
  const restored = Constructor.fromJson(JSON.stringify(wallet)) as unknown as NeuraiHDWallet;
  expect(restored.getID()).toBe(wallet.getID());
  return { addresses: await restored.getAddressesAsync(), receive: await restored.getReceiveAddressAsync() };
}

/** Witness version and program of a Bech32m address, independent of its HRP. */
const witnessWords = (address: string) => bech32m.decode(address, 120).words;

test.each(['xna', 'xna-test'])('preserves existing %s Legacy receive/change addresses across the library upgrade', async network => {
  const { addresses, receive } = await restoredAddresses(NeuraiHDWallet, network === 'xna' ? 'mainnet' : 'testnet');
  expect(addresses).toEqual(fixture(network).addresses);
  expect(receive).toBe(fixture(network).addresses[0]);
});

test('keeps the mainnet PQ commitments, re-encoded from nq1p… to nc1p…', async () => {
  const { addresses, receive } = await restoredAddresses(NeuraiPQWallet, 'mainnet');
  const old = fixture('xna-pq').addresses;
  expect(addresses).toHaveLength(old.length);
  addresses.forEach((address, i) => {
    expect(address.startsWith('nc1p')).toBe(true);
    // Same witness v1 program: only the HRP (and so the checksum) changed.
    expect(witnessWords(address)).toEqual(witnessWords(old[i]));
  });
  expect(receive).toBe(addresses[0]);
});

test('testnet PQ wallets use strict PQ witness v2 addresses (testnet was reset)', async () => {
  const { addresses, receive } = await restoredAddresses(NeuraiPQWallet, 'testnet');
  expect(addresses).toHaveLength(fixture('xna-pq-test').addresses.length);
  addresses.forEach((address, i) => {
    expect(address).toBe(getPQAddress('xna-pq-test', fixtures.mnemonic, 0, i).address);
    expect(address.startsWith('tpq1z')).toBe(true);
  });
  expect(receive).toBe(addresses[0]);
});
