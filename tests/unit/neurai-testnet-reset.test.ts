// Testnet was reset with a new genesis: cached testnet state is discarded,
// never migrated, and mainnet state is left alone.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TESTNET_GENESIS_HASH } from '@neuraiproject/neurai-rpc';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import { purgeStaleTestnetStorage } from '../../blue_modules/neurai/testnetReset';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Serialized wallet with cached chain state, as an older app version saved it. */
function savedWallet(wallet: NeuraiHDWallet | NeuraiPQWallet, testnetGenesis?: string): string {
  wallet.setLabel('kept label');
  wallet.balance = 123n;
  wallet.addressPosition = 7;
  wallet._lastTxBlockHeight = 99;
  const json = JSON.parse(JSON.stringify(wallet));
  json._txCache = [{ txid: 'aa'.repeat(32) }];
  json._heldAssets = [{ name: 'OLD' }];
  if (testnetGenesis === undefined) delete json.testnetGenesis;
  else json.testnetGenesis = testnetGenesis;
  return JSON.stringify(json);
}

describe('wallet JSON', () => {
  it('drops the cached chain state of a testnet wallet saved before the reset', () => {
    const restored = NeuraiHDWallet.fromJson(savedWallet(NeuraiHDWallet.forNetwork('testnet', MNEMONIC))) as unknown as NeuraiHDWallet;
    expect(restored.getSecret()).toBe(MNEMONIC);
    expect(restored.getLabel()).toBe('kept label');
    expect(restored.balance).toBe(0n);
    expect(restored.addressPosition).toBe(0);
    expect(restored._lastTxBlockHeight).toBe(0);
    expect(restored.getTransactions()).toEqual([]);
    expect(restored.testnetGenesis).toBe(TESTNET_GENESIS_HASH);
  });

  it('also resets PQ testnet wallets saved for another genesis', () => {
    const restored = NeuraiPQWallet.fromJson(
      savedWallet(NeuraiPQWallet.forNetwork('testnet', MNEMONIC), 'ff'.repeat(32)),
    ) as unknown as NeuraiPQWallet;
    expect(restored.balance).toBe(0n);
    expect(restored.addressPosition).toBe(0);
  });

  it('keeps testnet state saved for the current genesis', () => {
    const restored = NeuraiHDWallet.fromJson(
      savedWallet(NeuraiHDWallet.forNetwork('testnet', MNEMONIC), TESTNET_GENESIS_HASH),
    ) as unknown as NeuraiHDWallet;
    expect(restored.balance).toBe(123n);
    expect(restored.addressPosition).toBe(7);
  });

  it('never touches mainnet wallets', () => {
    const restored = NeuraiHDWallet.fromJson(savedWallet(NeuraiHDWallet.forNetwork('mainnet', MNEMONIC))) as unknown as NeuraiHDWallet;
    expect(restored.balance).toBe(123n);
    expect(restored.addressPosition).toBe(7);
  });

  it('marks new wallets with the current testnet genesis', () => {
    expect(JSON.parse(JSON.stringify(NeuraiHDWallet.forNetwork('testnet', MNEMONIC))).testnetGenesis).toBe(TESTNET_GENESIS_HASH);
  });
});

describe('DePIN caches', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('removes the old testnet DePIN state once and keeps mainnet', async () => {
    await AsyncStorage.multiSet([
      ['depin_pool_pin_testnet|wss://wallet-testnet-wss.neurai.org/push', '{}'],
      ['depin_pool_pin_mainnet|wss://wallet-main-wss.neurai.org/push', '{}'],
      ['depin_session_tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES', '{}'],
      ['depin_session_NWeC9vTbTHJXMJyWt93CVeD8HQYjc4HMwt', '{}'],
      ['depin_ready_tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES', '1'],
      ['depin_pool_seen_testwallet', 'sig'],
      ['depin_pool_seen_mainwallet', 'sig'],
      ['depin_revealed_testwallet', '1'],
      ['depin_private_msg_hash1', 'tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES'],
      ['depin_private_msg_hash2', 'NWeC9vTbTHJXMJyWt93CVeD8HQYjc4HMwt'],
    ]);

    await purgeStaleTestnetStorage(['testwallet']);

    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(
      [
        'depin_pool_pin_mainnet|wss://wallet-main-wss.neurai.org/push',
        'depin_session_NWeC9vTbTHJXMJyWt93CVeD8HQYjc4HMwt',
        'depin_pool_seen_mainwallet',
        'depin_private_msg_hash2',
        'neurai_testnet_genesis',
      ].sort(),
    );

    // Already done for this genesis: new testnet state survives later launches.
    await AsyncStorage.setItem('depin_ready_tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES', '1');
    await purgeStaleTestnetStorage(['testwallet']);
    expect(await AsyncStorage.getItem('depin_ready_tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES')).toBe('1');
  });
});
