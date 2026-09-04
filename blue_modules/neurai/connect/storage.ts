/**
 * Storage adapter for the Neurai Connect SDK.
 *
 * Everything the SDK persists is secret material: the symmetric key of every
 * pairing and session, the relay client key, and the list of topics we listen
 * on. It therefore lives in `RNSecureKeyStore` with
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, the same store the wallets use, and never in
 * AsyncStorage.
 *
 * `RNSecureKeyStore` cannot enumerate keys, so the adapter keeps its own index
 * entry; that is enough for the SDK, which only reads and writes a handful of
 * fixed keys.
 */

import RNSecureKeyStore, { ACCESSIBLE } from 'react-native-secure-key-store';
import type { KeyValueStorage } from '@neuraiproject/neurai-connect-core';

const PREFIX = 'NEURAI_CONNECT_';
const INDEX_KEY = `${PREFIX}__index__`;

const options = { accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function readRaw(key: string): Promise<string | undefined> {
  try {
    const raw = await RNSecureKeyStore.get(key);
    return typeof raw === 'string' ? raw : undefined;
  } catch {
    // The store throws when the key does not exist; that is not an error here.
    return undefined;
  }
}

export class SecureConnectStorage implements KeyValueStorage {
  private index: Set<string> | null = null;

  private async loadIndex(): Promise<Set<string>> {
    if (this.index) return this.index;
    const raw = await readRaw(INDEX_KEY);
    let keys: string[] = [];
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) keys = parsed.filter((k): k is string => typeof k === 'string');
      } catch {
        keys = [];
      }
    }
    this.index = new Set(keys);
    return this.index;
  }

  private async saveIndex(): Promise<void> {
    const index = await this.loadIndex();
    await RNSecureKeyStore.set(INDEX_KEY, JSON.stringify([...index]), options);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await readRaw(PREFIX + key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await RNSecureKeyStore.set(PREFIX + key, JSON.stringify(value), options);
    const index = await this.loadIndex();
    if (!index.has(key)) {
      index.add(key);
      await this.saveIndex();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await RNSecureKeyStore.remove(PREFIX + key);
    } catch {
      // Already gone.
    }
    const index = await this.loadIndex();
    if (index.delete(key)) await this.saveIndex();
  }

  async keys(prefix?: string): Promise<string[]> {
    const index = await this.loadIndex();
    const all = [...index];
    return prefix === undefined ? all : all.filter(k => k.startsWith(prefix));
  }

  /** Wipes every Neurai Connect entry. Used by "log out everywhere". */
  async clear(): Promise<void> {
    for (const key of await this.keys()) {
      try {
        await RNSecureKeyStore.remove(PREFIX + key);
      } catch {
        // Ignore: the entry may not exist.
      }
    }
    this.index = new Set();
    await this.saveIndex();
  }
}
