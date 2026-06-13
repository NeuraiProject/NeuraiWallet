import assert from 'assert';

import { CHAIN_PARAMS, createDefaultBackend, createDefaultRpcBackend } from '../../blue_modules/neurai';
import { estimateNeuraiFeeSats, estimateNeuraiTxSizeKb } from '../../blue_modules/neurai/feeEstimate';
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
      // Caches are intentionally persisted (enumerable) so the UI can render
      // history and pending sends instantly on launch, before the next refresh.
      assert.ok('_historyItems' in json, '_historyItems should persist for offline render');
      assert.ok('_txCache' in json, '_txCache should persist for offline render');
      assert.ok('_pendingTxs' in json, '_pendingTxs should persist so pending sends survive a restart');
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

  describe('pending (optimistic) transactions', () => {
    const confirmedTx = (txid: string, value: number, confirmations: number) => ({
      txid,
      hash: txid,
      version: 0,
      size: 0,
      vsize: 0,
      weight: 0,
      locktime: 0,
      inputs: [],
      outputs: [],
      blockhash: '',
      confirmations,
      time: 123,
      blocktime: 123,
      timestamp: 123,
      value,
    });

    it('shows a just-broadcast send as a 0-conf entry and subtracts it from the balance', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000;
      w.addPendingTx('aa', -300_000);
      const txs = w.getTransactions();
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].txid, 'aa');
      assert.strictEqual(txs[0].confirmations, 0);
      assert.strictEqual(txs[0].value, -300_000);
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000);
      assert.strictEqual(w.getBalance(), 700_000);
    });

    it('drops the pending entry once the tx confirms in the cache', () => {
      const w = new NeuraiHDWallet();
      w.balance = 700_000; // backend confirmed balance after the spend mined
      w.addPendingTx('aa', -300_000);
      (w as any)._txCache = [confirmedTx('aa', -300_000, 1)];
      const txs = w.getTransactions();
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].confirmations, 1);
      assert.strictEqual(w.getUnconfirmedBalance(), 0);
      assert.strictEqual(w.getBalance(), 700_000);
    });

    it('hides the duplicate but keeps deducting while the tx is only 0-conf in the cache', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000; // confirmed balance unchanged while in mempool
      w.addPendingTx('aa', -300_000);
      (w as any)._txCache = [confirmedTx('aa', -300_000, 0)]; // backend surfaced it 0-conf
      assert.strictEqual(w.getTransactions().length, 1, 'no duplicate row');
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000, 'still deducted until confirmed');
      assert.strictEqual(w.getBalance(), 700_000);
    });

    it('expires a pending entry that never confirms (TTL)', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000;
      w.addPendingTx('aa', -300_000);
      (w as any)._pendingTxs[0].timestamp = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
      assert.strictEqual(w.getTransactions().length, 0);
      assert.strictEqual(w.getUnconfirmedBalance(), 0);
      assert.strictEqual(w.getBalance(), 1_000_000);
    });

    it('does not double-count against a server-reported unconfirmed balance', () => {
      const w = new NeuraiPQWallet();
      w.balance = 1_000_000;
      w.unconfirmed_balance = -300_000; // PQ push already reflected the same spend
      w.addPendingTx('aa', -300_000);
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000); // min(-300k, -300k), not -600k
      assert.strictEqual(w.getBalance(), 700_000);
    });

    it('ignores a duplicate addPendingTx for the same txid', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000;
      w.addPendingTx('aa', -300_000);
      w.addPendingTx('aa', -300_000);
      assert.strictEqual(w.getTransactions().length, 1);
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000);
    });
  });

  describe('fee estimate (send-max parity with the engine)', () => {
    const legacyScript = '76a914' + '00'.repeat(20) + '88ac';
    const pqScript = '5114' + '00'.repeat(20);

    it('uses legacy input/output sizes (148 / 34) and base 10', () => {
      assert.strictEqual(estimateNeuraiTxSizeKb([legacyScript], ['NfooLegacyAddress']), 192 / 1024);
      // ceil((192/1024) * 0.05 XNA/kB * 1e8) = ceil(937500)
      assert.strictEqual(estimateNeuraiFeeSats([legacyScript], ['NfooLegacyAddress'], 0.05), 937_500);
    });

    it('uses PQ input/output sizes (976 / 31) and base 12 for AuthScript', () => {
      assert.strictEqual(estimateNeuraiTxSizeKb([pqScript], ['nq1footestaddress']), 1019 / 1024);
      // ceil((1019/1024) * 0.05 * 1e8) = ceil(4975585.9375)
      assert.strictEqual(estimateNeuraiFeeSats([pqScript], ['nq1footestaddress'], 0.05), 4_975_586);
    });
  });
});
