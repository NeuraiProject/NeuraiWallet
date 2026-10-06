/**
 * Durable compare-and-swap string store for the C6 journals.
 *
 * Replaces the web wallet's `IndexedDbSponsorStore`: same `read` /
 * `compareAndSwap` contract, one file per key under the app's documents
 * directory. Values are written to a temporary file and renamed into place,
 * and every operation on a store is serialized, which is enough inside the
 * app's single JS context. The private journal values are already encrypted
 * by the library with a key derived from the wallet words.
 *
 * AsyncStorage is not used: its Android rows are limited to about 2 MB and a
 * journal may reach 8 MB.
 */

import RNFS from 'react-native-fs';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const ROOT = `${RNFS.DocumentDirectoryPath}/neurai-privacy/stores`;

export class FileCasStore {
  private readonly dir: string;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(name: 'c6-private-journal-v1' | 'c6-sponsor-journal-v1') {
    this.dir = `${ROOT}/${name}`;
  }

  private file(key: string): string {
    if (typeof key !== 'string' || !key) throw new Error('Invalid journal key');
    return `${this.dir}/${bytesToHex(sha256(utf8ToBytes(key)))}`;
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => {});
    return run;
  }

  private async readFile(path: string): Promise<string | null> {
    if (!(await RNFS.exists(path))) return null;
    return RNFS.readFile(path, 'utf8');
  }

  read(key: string): Promise<string | null> {
    const path = this.file(key);
    return this.serialize(() => this.readFile(path));
  }

  compareAndSwap(key: string, expected: string | null, replacement: string): Promise<boolean> {
    const path = this.file(key);
    return this.serialize(async () => {
      if ((await this.readFile(path)) !== expected) return false;
      await RNFS.mkdir(this.dir);
      const temp = `${path}.tmp`;
      await RNFS.writeFile(temp, replacement, 'utf8');
      await RNFS.moveFile(temp, path);
      return true;
    });
  }

  /** Nothing to release; present for parity with the IndexedDB store. */
  async close(): Promise<void> {}
}

/**
 * Exclusive named locks for `C6SponsorFlow`, which on the web requires Web
 * Locks to keep two tabs from spending the same sponsor coins. The app has a
 * single JS context, so serializing callbacks per name gives the same guarantee.
 */
export function createLocalLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, _options: unknown, callback: (lock: { name: string; mode: 'exclusive' }) => Promise<T> | T): Promise<T> {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(
        () => callback({ name, mode: 'exclusive' }),
        () => callback({ name, mode: 'exclusive' }),
      );
      const settled = run.catch(() => {});
      tails.set(name, settled);
      settled.then(() => {
        if (tails.get(name) === settled) tails.delete(name);
      });
      return run;
    },
  };
}
