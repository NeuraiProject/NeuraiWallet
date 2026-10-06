import assert from 'assert';
import { bech32m } from 'bech32';
import fixtures from './fixtures/neurai-key4-addresses.json';
import { RpcBackend } from '../../blue_modules/neurai/RpcBackend';

import { getAddressPair } from '@neuraiproject/neurai-key';
import * as bitcoin from 'bitcoinjs-lib';
import { CHAIN_PARAMS, chainFor, createDefaultBackend, isKindAvailable, isTestnetChain, kindOfChain } from '../../blue_modules/neurai';
import { signerNetworkFor } from '../../blue_modules/neurai/keyNetwork';
import { estimateNeuraiFeeSats, estimateNeuraiTxSizeKb } from '../../blue_modules/neurai/feeEstimate';
import { AbstractNeuraiWallet } from '../../class/wallets/abstract-neurai-wallet';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import { NeuraiECDSAWallet } from '../../class/wallets/neurai-ecdsa-wallet';

const KNOWN_MNEMONIC = 'result pact model attract result puzzle final boss private educate luggage era';

describe('Neurai wallets', () => {
  describe('backend defaults', () => {
    it('uses wallet-service WSS endpoints by default', () => {
      assert.strictEqual(CHAIN_PARAMS.xna.defaultWssUrl, 'wss://wallet-main-wss.neurai.org:443/push');
      assert.strictEqual(CHAIN_PARAMS['xna-test'].defaultWssUrl, 'wss://wallet-testnet-wss.neurai.org:443/push');
      assert.strictEqual(CHAIN_PARAMS['xna-test'].defaultWssAuthToken, 'testnet-wss-token-do-not-use-in-production');
      assert.strictEqual(createDefaultBackend('mainnet', 'legacy').kind, 'wss');
      assert.strictEqual(createDefaultBackend('testnet', 'legacy').kind, 'wss');
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

    it('derives a testnet strict PQ bech32m address with tpq1 prefix', async () => {
      const w = NeuraiPQWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      const hrp = CHAIN_PARAMS['xna-pq-test'].hrp ?? '';
      assert.ok(address.startsWith(`${hrp}1`), `expected ${hrp}1 prefix, got ${address}`);
    }, 30_000);

    it('derives a mainnet AuthScript PQ bech32m address with nc1p prefix', async () => {
      const w = NeuraiPQWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      assert.ok(address.startsWith('nc1p'), `expected nc1p prefix, got ${address}`);
    }, 30_000);
  });

  describe('NeuraiECDSAWallet', () => {
    const ecdsaPair = (network: 'xna' | 'xna-test', index: number) =>
      getAddressPair(network, KNOWN_MNEMONIC, 0, index) as unknown as {
        external: { address: string; path: string; commitment: string; publicKey: string };
        internal: { address: string; path: string };
      };

    it('defaults to xna-ecdsa-test on testnet', () => {
      const w = new NeuraiECDSAWallet();
      assert.strictEqual(w.network, 'xna-ecdsa-test');
      assert.strictEqual(w.walletKind, 'ecdsa');
      assert.strictEqual(w.type, 'NeuraiECDSA');
      assert.strictEqual(w.allowSweepFromWif(), true);
      assert.strictEqual(w.getEngineNetwork(), 'xna-ecdsa-test');
    });

    it('maps the ECDSA chains', () => {
      assert.strictEqual(chainFor('testnet', 'ecdsa'), 'xna-ecdsa-test');
      assert.strictEqual(chainFor('mainnet', 'ecdsa'), 'xna-ecdsa');
      assert.strictEqual(kindOfChain('xna-ecdsa-test'), 'ecdsa');
      assert.strictEqual(isTestnetChain('xna-ecdsa-test'), true);
      assert.strictEqual(isTestnetChain('xna-ecdsa'), false);
      assert.strictEqual(signerNetworkFor('xna-ecdsa-test'), 'xna-test');
      // Witness families are testnet-only until they activate on mainnet.
      assert.strictEqual(isKindAvailable('mainnet', 'ecdsa'), false);
      assert.strictEqual(isKindAvailable('mainnet', 'pq'), false);
      assert.strictEqual(isKindAvailable('mainnet', 'legacy'), true);
      assert.strictEqual(isKindAvailable('testnet', 'ecdsa'), true);
    });

    it('rejects Legacy and PQ networks', () => {
      const w = new NeuraiECDSAWallet();
      assert.throws(() => w.setNetwork('xna-test'), /Wallet kind mismatch/);
      assert.throws(() => w.setNetwork('xna-pq-test'), /Wallet kind mismatch/);
      assert.throws(() => new NeuraiHDWallet().setNetwork('xna-ecdsa-test'), /Wallet kind mismatch/);
    });

    it("derives the node's witness v3 addresses under m/84'", async () => {
      const w = NeuraiECDSAWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      const expected = ecdsaPair('xna-test', 0);
      assert.strictEqual(address, expected.external.address);
      assert.strictEqual(expected.external.path, "m/84'/1'/0'/0/0");
      assert.ok(address.startsWith('tnq1r'), `expected tnq1r prefix, got ${address}`);
      assert.ok(w.weOwnAddress(expected.internal.address), 'the change branch belongs to the wallet');
      const legacy = await NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC).getReceiveAddressAsync();
      assert.notStrictEqual(address, legacy);
    }, 30_000);

    it('derives mainnet nq1r addresses', async () => {
      const w = NeuraiECDSAWallet.forNetwork('mainnet', KNOWN_MNEMONIC);
      const address = await w.getReceiveAddressAsync();
      assert.strictEqual(address, ecdsaPair('xna', 0).external.address);
      assert.ok(address.startsWith('nq1r'), `expected nq1r prefix, got ${address}`);
    }, 30_000);

    it('round-trips via fromJson as an ECDSA wallet', () => {
      const w = NeuraiECDSAWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const restored = NeuraiECDSAWallet.fromJson(JSON.stringify(w)) as unknown as NeuraiECDSAWallet;
      assert.strictEqual(restored.type, 'NeuraiECDSA');
      assert.strictEqual(restored.network, 'xna-ecdsa-test');
      assert.strictEqual(restored.getSecret(), KNOWN_MNEMONIC);
    });

    it('signs a spend of its witness v3 coin with the [0x02, sig, pubkey, OP_TRUE] witness', async () => {
      const w = NeuraiECDSAWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const own = ecdsaPair('xna-test', 0).external;
      const txid = 'ab'.repeat(32);
      const rpc = jest.fn(async (method: string) => {
        if (method === 'getaddressutxos') {
          return [
            {
              address: own.address,
              assetName: 'XNA',
              txid,
              outputIndex: 1,
              script: `5320${own.commitment}`,
              satoshis: 500_000_000,
              height: 100,
            },
          ];
        }
        if (method === 'getaddressmempool') return [];
        if (method === 'gettxout') return { value: 5, scriptPubKey: { hex: `5320${own.commitment}` } };
        throw new Error(`unexpected rpc ${method}`);
      });
      jest.spyOn(w, 'getBackend').mockReturnValue({ chain: 'xna-ecdsa-test', rpc } as never);
      const built = await w.buildSendTransaction([{ address: ecdsaPair('xna-test', 1).external.address, amount: '1' }]);
      const tx = bitcoin.Transaction.fromHex(built.signedHex);
      assert.strictEqual(tx.ins.length, 1);
      assert.strictEqual(Buffer.from(tx.ins[0].hash).reverse().toString('hex'), txid);
      const witness = tx.ins[0].witness.map(item => Buffer.from(item).toString('hex'));
      assert.strictEqual(witness.length, 4);
      assert.strictEqual(witness[0], '02');
      assert.strictEqual(witness[2], own.publicKey);
      assert.strictEqual(witness[3], '51');
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
    const confirmedTx = (txid: string, value: bigint, confirmations: number) => ({
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
      w.balance = 1_000_000n;
      w.addPendingTx('aa', -300_000n);
      const txs = w.getTransactions();
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].txid, 'aa');
      assert.strictEqual(txs[0].confirmations, 0);
      assert.strictEqual(txs[0].value, -300_000n);
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000n);
      assert.strictEqual(w.getBalance(), 700_000n);
    });

    it('drops the pending entry once the tx confirms in the cache', () => {
      const w = new NeuraiHDWallet();
      w.balance = 700_000n; // backend confirmed balance after the spend mined
      w.addPendingTx('aa', -300_000n);
      (w as any)._txCache = [confirmedTx('aa', -300_000n, 1)];
      const txs = w.getTransactions();
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].confirmations, 1);
      assert.strictEqual(w.getUnconfirmedBalance(), 0n);
      assert.strictEqual(w.getBalance(), 700_000n);
    });

    it('hides the duplicate but keeps deducting while the tx is only 0-conf in the cache', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000n; // confirmed balance unchanged while in mempool
      w.addPendingTx('aa', -300_000n);
      (w as any)._txCache = [confirmedTx('aa', -300_000n, 0)]; // backend surfaced it 0-conf
      assert.strictEqual(w.getTransactions().length, 1, 'no duplicate row');
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000n, 'still deducted until confirmed');
      assert.strictEqual(w.getBalance(), 700_000n);
    });

    it('expires a pending entry that never confirms (TTL)', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000n;
      w.addPendingTx('aa', -300_000n);
      (w as any)._pendingTxs[0].timestamp = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
      assert.strictEqual(w.getTransactions().length, 0);
      assert.strictEqual(w.getUnconfirmedBalance(), 0n);
      assert.strictEqual(w.getBalance(), 1_000_000n);
    });

    it('does not double-count against a server-reported unconfirmed balance', () => {
      const w = new NeuraiPQWallet();
      w.balance = 1_000_000n;
      w.unconfirmed_balance = -300_000n; // PQ push already reflected the same spend
      w.addPendingTx('aa', -300_000n);
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000n); // min(-300k, -300k), not -600k
      assert.strictEqual(w.getBalance(), 700_000n);
    });

    it('ignores a duplicate addPendingTx for the same txid', () => {
      const w = new NeuraiHDWallet();
      w.balance = 1_000_000n;
      w.addPendingTx('aa', -300_000n);
      w.addPendingTx('aa', -300_000n);
      assert.strictEqual(w.getTransactions().length, 1);
      assert.strictEqual(w.getUnconfirmedBalance(), -300_000n);
    });
  });

  describe('library transaction sizing and exact fees', () => {
    const legacyScript = '76a914' + '00'.repeat(20) + '88ac';
    // Witness v1: OP_1 (0x51) + push-32 (0x20) + a 32-byte program. The old
    // fixture used '5114' (push-20), which `isPQScript` does not match, so this
    // suite measured the LEGACY branch and never covered PQ sizing at all.
    const pqScript = '5120' + '00'.repeat(32);
    // The fixture keeps the 4.x `nq1p…` string; libraries only accept its `nc1p…` encoding.
    const pqFixtureAddress = bech32m.encode('nc', bech32m.decode(fixtures.fixtures[2].addresses[0], 120).words, 120);

    it('uses conservative serialized legacy signatures and decimal kilobytes', () => {
      assert.strictEqual(estimateNeuraiTxSizeKb([legacyScript], [fixtures.fixtures[0].addresses[0]]), 193 / 1000);
      assert.strictEqual(estimateNeuraiFeeSats([legacyScript], [fixtures.fixtures[0].addresses[0]], 0.05), 965_000n);
    });

    it('counts asset payloads, mixed destinations, and CompactSize boundaries', () => {
      const address = fixtures.fixtures[0].addresses[0];
      const pqAddress = pqFixtureAddress;
      const plain = estimateNeuraiFeeSats([legacyScript], [address], 0.012);
      expect(plain).toBe(231_600n);
      expect(estimateNeuraiFeeSats([legacyScript], [pqAddress], 0.012)).toBe(plain + 9n * 1200n);
      expect(estimateNeuraiFeeSats([legacyScript], [{ address, assetName: 'FEE_TEST' }], 0.012)).toBeGreaterThan(plain);
      const before = estimateNeuraiFeeSats(Array(252).fill(legacyScript), [address], 0.012);
      const after = estimateNeuraiFeeSats(Array(253).fill(legacyScript), [address], 0.012);
      expect(after - before).toBe((149n + 2n) * 1200n);
    });

    it('rounds fractional satoshi fees up and rejects invalid rates', () => {
      const outputs = [fixtures.fixtures[0].addresses[0]];
      expect(estimateNeuraiFeeSats([legacyScript], outputs, 0.00000001)).toBe(1n);
      expect(() => estimateNeuraiFeeSats([legacyScript], outputs, NaN)).toThrow('Invalid fee');
      expect(() => estimateNeuraiFeeSats([legacyScript], outputs, -1)).toThrow('Invalid fee');
    });

    it('accounts for the PQ witness discount', () => {
      assert.strictEqual(estimateNeuraiTxSizeKb([pqScript], [pqFixtureAddress]), 1031 / 1000);
      assert.strictEqual(estimateNeuraiFeeSats([pqScript], [pqFixtureAddress], 0.05), 5_155_000n);
    });
  });
});

describe('exact send preflight', () => {
  it('rejects duplicated recipients and invalid precision before building', async () => {
    const wallet = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
    await expect(
      wallet.buildSendTransaction([
        { address: 'same', amount: '1' },
        { address: 'same', amount: '2' },
      ]),
    ).rejects.toThrow('Duplicate');
    await expect(wallet.buildSendTransaction([{ address: 'same', amount: '0.000000001' }])).rejects.toThrow('8 decimal');
  });
  it('does not unlock an obsolete wallet when balance refresh fails', async () => {
    const wallet = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
    wallet.amountsStale = true;
    const backend = new RpcBackend({ chain: 'xna-test', url: 'http://127.0.0.1:19215' });
    jest.spyOn(backend, 'getBalance').mockRejectedValue(new Error('Offline'));
    wallet.setBackend(backend);
    await expect(wallet.fetchBalance()).rejects.toThrow('Offline');
    expect(wallet.amountsStale).toBe(true);
  });
});

it('subtracts a one-satoshi pending debit above the safe integer boundary exactly', () => {
  const wallet = new NeuraiHDWallet();
  wallet.balance = 9007199254740993n;
  wallet.addPendingTx('one-satoshi', -1n);
  expect(wallet.getBalance()).toBe(9007199254740992n);
});
