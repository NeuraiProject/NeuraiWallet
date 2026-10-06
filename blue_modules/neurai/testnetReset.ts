/**
 * One-shot cleanup after a testnet reset.
 *
 * Testnet was restarted with a new genesis, so every cached testnet fact
 * (balances, history, DePIN pool pins, sessions, seen markers) describes a
 * chain that no longer exists. Nothing from it is kept or migrated: wallets
 * keep their words and label and resync from scratch. Mainnet data is never
 * touched.
 *
 * The marker is the testnet genesis hash, so a future reset only needs a new
 * hash in `networkConfig.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHAIN_PARAMS } from './networkConfig';
import { PRIVACY_TX_TAGS_PREFIX } from './privacy/txTags';

/** Genesis of the testnet the app's cached testnet state belongs to. */
export const CURRENT_TESTNET_GENESIS = CHAIN_PARAMS['xna-test'].expectedGenesisHash ?? '';

const MARKER_KEY = 'neurai_testnet_genesis';

// Testnet Legacy P2PKH addresses start with `t`; mainnet ones with `N`.
const isTestnetAddress = (address: string | null | undefined): boolean => typeof address === 'string' && address.startsWith('t');

/**
 * Remove the testnet DePIN caches kept outside the wallet JSON. `testnetWalletIds`
 * are the testnet wallets loaded on this launch; their per-wallet keys go too.
 */
export async function purgeStaleTestnetStorage(testnetWalletIds: string[]): Promise<void> {
  if (!CURRENT_TESTNET_GENESIS) return;
  if ((await AsyncStorage.getItem(MARKER_KEY)) === CURRENT_TESTNET_GENESIS) return;

  const keys = await AsyncStorage.getAllKeys();
  const walletKeys = new Set(
    testnetWalletIds.flatMap(id => [`depin_pool_seen_${id}`, `depin_revealed_${id}`, `${PRIVACY_TX_TAGS_PREFIX}${id}`]),
  );
  const stale = keys.filter(
    key =>
      key.startsWith('depin_pool_pin_testnet|') ||
      walletKeys.has(key) ||
      (key.startsWith('depin_session_') && isTestnetAddress(key.slice('depin_session_'.length))) ||
      (key.startsWith('depin_ready_') && isTestnetAddress(key.slice('depin_ready_'.length))),
  );

  // Private-message recipients are keyed by message hash; the value is the address.
  const privateKeys = keys.filter(key => key.startsWith('depin_private_msg_'));
  if (privateKeys.length) {
    for (const [key, value] of await AsyncStorage.multiGet(privateKeys)) {
      if (isTestnetAddress(value)) stale.push(key);
    }
  }

  if (stale.length) await AsyncStorage.multiRemove(stale);
  await AsyncStorage.setItem(MARKER_KEY, CURRENT_TESTNET_GENESIS);
}
