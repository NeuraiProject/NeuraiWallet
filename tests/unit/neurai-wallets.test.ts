import assert from 'assert';

import { CHAIN_PARAMS, createDefaultBackend, createDefaultRpcBackend } from '../../blue_modules/neurai';
import { AbstractNeuraiWallet } from '../../class/wallets/abstract-neurai-wallet';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';

const KNOWN_MNEMONIC = 'result pact model attract result puzzle final boss private educate luggage era';

describe('Neurai wallets', () => {
  describe('backend defaults', () => {
    it('uses wallet-service WSS endpoints by default', () => {
      assert.strictEqual(CHAIN_PARAMS.xna.defaultWssUrl, 'wss://wallet-main-wss.neurai.org:443/push');
      assert.strictEqual(CHAIN_PARAMS['xna-test'].defaultWssUrl, 'wss://wallet-testnet-wss.neurai.org:443/push');
      assert.strictEqual(CHAIN_PARAMS['xna-test'].defaultWssAuthToken, 'testnet-wss-token-do-not-use-in-production');
      assert.strictEqual(createDefaultBackend('mainnet', 'legacy').kind, 'wss');
      assert.strictEqual(createDefaultRpcBackend('mainnet', 'legacy').kind, 'rpc');
    });
  });

  describe('NeuraiHDWallet', () => {
    it('defaults to xna-test on testnet', () => {
      const w = new NeuraiHDWallet();
      assert.strictEqual(w.network, 'xna-test');
      assert.strictEqual(w.walletKind, 'legacy');
      assert.strictEqual(w.type, 'NeuraiHD');
      assert.strictEqual(w.typeReadable, 'Neurai HD');
    });

    it('forNetwork builds a wallet pre-configured for mainnet', () => {
      const w = NeuraiHDWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      assert.strictEqual(w.network, 'xna');
      assert.strictEqual(w.getNeuraiNetwork(), 'mainnet');
      assert.strictEqual(w.getSecret(), KNOWN_MNEMONIC);
    });

    it('rejects PQ networks', () => {
      const w = new NeuraiHDWallet();
      assert.throws(() => w.setNetwork('xna-pq-test'), /Wallet kind mismatch/);
      assert.throws(() => w.setNetwork('xna-pq'), /Wallet kind mismatch/);
    });

    it('derives a testnet receive address starting with t', async () => {
      const w = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      assert.strictEqual(typeof address, 'string');
      assert.ok(address.startsWith('t'), `expected testnet prefix, got ${address}`);
      assert.ok(w.weOwnAddress(address), 'wallet should recognise its own derived address');
    }, 30_000);

    it('derives a mainnet receive address starting with N', async () => {
      const w = NeuraiHDWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      assert.ok(address.startsWith('N'), `expected mainnet prefix, got ${address}`);
    }, 30_000);

    it('mainnet and testnet derive different addresses from the same mnemonic', async () => {
      const main = NeuraiHDWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      const test = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const mainAddr = await main.getReceiveAddressAsync();
      const testAddr = await test.getReceiveAddressAsync();
      assert.notStrictEqual(mainAddr, testAddr);
    }, 30_000);
  });

  describe('NeuraiPQWallet', () => {
    it('defaults to xna-pq-test on testnet', () => {
      const w = new NeuraiPQWallet();
      assert.strictEqual(w.network, 'xna-pq-test');
      assert.strictEqual(w.walletKind, 'pq');
      assert.strictEqual(w.allowSweepFromWif(), false);
    });

    it('rejects legacy networks', () => {
      const w = new NeuraiPQWallet();
      assert.throws(() => w.setNetwork('xna'), /Wallet kind mismatch/);
      assert.throws(() => w.setNetwork('xna-test'), /Wallet kind mismatch/);
    });

    it('derives a testnet PQ bech32m address with tnq1 prefix', async () => {
      const w = NeuraiPQWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      const hrp = CHAIN_PARAMS['xna-pq-test'].hrp ?? '';
      assert.ok(address.startsWith(`${hrp}1`), `expected ${hrp}1 prefix, got ${address}`);
    }, 30_000);

    it('derives a mainnet PQ bech32m address with nq1 prefix', async () => {
      const w = NeuraiPQWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      assert.ok(address.startsWith('nq1'), `expected nq1 prefix, got ${address}`);
    }, 30_000);
  });

  describe('serialization', () => {
    it('does not persist runtime engine/backend in JSON', async () => {
      const w = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      await w.getReceiveAddressAsync();
      const json = JSON.parse(JSON.stringify(w));
      assert.ok(!('_engine' in json), '_engine must not be serialized');
      assert.ok(!('_backend' in json), '_backend must not be serialized');
      assert.ok(!('_historyItems' in json), '_historyItems must not be serialized');
      assert.ok(!('_txCache' in json), '_txCache must not be serialized');
      assert.strictEqual(json.network, 'xna-test');
      assert.strictEqual(json.secret, KNOWN_MNEMONIC);
      assert.strictEqual(json.type, 'NeuraiHD');
    }, 30_000);

    it('round-trips via fromJson preserving network and secret', async () => {
      const original = NeuraiHDWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      await original.getReceiveAddressAsync();
      const restored = NeuraiHDWallet.fromJson(JSON.stringify(original)) as unknown as NeuraiHDWallet;
      assert.ok(restored instanceof AbstractNeuraiWallet);
      assert.strictEqual(restored.network, 'xna');
      assert.strictEqual(restored.getSecret(), KNOWN_MNEMONIC);
      assert.strictEqual(restored.type, 'NeuraiHD');
    }, 30_000);
  });

  describe('passphrase', () => {
    it('different passphrases yield different addresses for the same mnemonic', async () => {
      const a = NeuraiHDWallet.forNetwork('mainnet', KNOWN_MNEMONIC, 'passphrase A');
      const b = NeuraiHDWallet.forNetwork('mainnet', KNOWN_MNEMONIC, 'passphrase B');
      const addrA = await a.getReceiveAddressAsync();
      const addrB = await b.getReceiveAddressAsync();
      assert.notStrictEqual(addrA, addrB);
    }, 30_000);
  });
});
