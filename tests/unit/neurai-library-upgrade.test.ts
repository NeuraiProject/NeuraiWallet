import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import fixtures from './fixtures/neurai-key4-addresses.json';

// Generated from the previous published jswallet 0.15.3 with key 4.0.1.
// These literals must not be regenerated merely to make an incompatible upgrade pass.
test.each(fixtures.fixtures)('preserves existing $network receive/change addresses across the library upgrade', async fixture => {
  const network = fixture.network.includes('test') ? 'testnet' : 'mainnet';
  const Constructor = fixture.network.includes('pq') ? NeuraiPQWallet : NeuraiHDWallet;
  const wallet = Constructor.forNetwork(network, fixtures.mnemonic);
  wallet.addressPosition = 1;
  const restored = Constructor.fromJson(JSON.stringify(wallet)) as unknown as NeuraiHDWallet;
  expect(restored.getID()).toBe(wallet.getID());
  expect(await restored.getAddressesAsync()).toEqual(fixture.addresses);
  expect(await restored.getReceiveAddressAsync()).toBe(fixture.addresses[0]);
});
