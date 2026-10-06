/**
 * C6 proving files (circuit .wasm, .zkey and verifying keys) on the device.
 *
 * About 88 MB per pool instance, too much for the APK, so they are downloaded
 * on first use from a configurable HTTPS location and kept in the app's
 * documents directory. The host is not trusted: every file is checked against
 * the size and SHA-256 pinned in the app's deployment before it is kept, and
 * the proving worker checks them again when it loads them.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

import type { C6Runtime } from './deployment';

const ROOT = `${RNFS.DocumentDirectoryPath}/neurai-privacy/c6`;
const URL_KEY_PREFIX = 'neurai_privacy_c6_files_url_';

export interface ArtifactFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface ArtifactStatus {
  present: number;
  total: number;
  bytesPresent: number;
  bytesTotal: number;
}

export type DownloadProgress = (info: { file: string; percent: number; done: number; total: number }) => void;

/** Location configured for an instance's proving files (falls back to the release default). */
export async function getArtifactBaseUrl(runtime: C6Runtime): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(URL_KEY_PREFIX + runtime.id);
    if (stored) return stored;
  } catch {
    // Storage errors fall back to the default location.
  }
  return runtime.defaultArtifactUrl;
}

export async function setArtifactBaseUrl(runtime: C6Runtime, url: string | null): Promise<void> {
  const value = (url ?? '').trim();
  if (!value) {
    await AsyncStorage.removeItem(URL_KEY_PREFIX + runtime.id);
    return;
  }
  if (!/^https?:\/\//i.test(value)) throw new Error('Use an http(s) URL for the proving files');
  await AsyncStorage.setItem(URL_KEY_PREFIX + runtime.id, value.endsWith('/') ? value : value + '/');
}

export class C6ArtifactStore {
  private readonly dir: string;
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly runtime: C6Runtime) {
    this.dir = `${ROOT}/${runtime.id}`;
  }

  files(): ArtifactFile[] {
    return Object.entries(this.runtime.config.artifacts.files).map(([name, meta]) => ({ name, bytes: meta.bytes, sha256: meta.sha256 }));
  }

  private pin(name: string): ArtifactFile {
    // Names come from the worker: only pinned file names map to a path.
    const meta = this.runtime.config.artifacts.files[name];
    if (!meta || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('Unknown proving file ' + name);
    return { name, bytes: meta.bytes, sha256: meta.sha256 };
  }

  private path(name: string): string {
    return `${this.dir}/${name}`;
  }

  /** True when the file is present with its pinned size (its hash was checked when it was kept). */
  private async present(file: ArtifactFile): Promise<boolean> {
    try {
      const stat = await RNFS.stat(this.path(file.name));
      return stat.isFile() && Number(stat.size) === file.bytes;
    } catch {
      return false;
    }
  }

  async status(): Promise<ArtifactStatus> {
    const files = this.files();
    const present = await Promise.all(files.map(f => this.present(f)));
    return {
      present: present.filter(Boolean).length,
      total: files.length,
      bytesPresent: files.reduce((sum, f, i) => sum + (present[i] ? f.bytes : 0), 0),
      bytesTotal: files.reduce((sum, f) => sum + f.bytes, 0),
    };
  }

  /** Local path of a verified proving file, downloading it first if needed. */
  ensure(name: string, onProgress?: (percent: number) => void): Promise<string> {
    const running = this.inFlight.get(name);
    if (running) return running;
    const job = this.fetchFile(this.pin(name), onProgress).finally(() => this.inFlight.delete(name));
    this.inFlight.set(name, job);
    return job;
  }

  private async fetchFile(file: ArtifactFile, onProgress?: (percent: number) => void): Promise<string> {
    const target = this.path(file.name);
    if (await this.present(file)) return target;
    await RNFS.mkdir(this.dir);
    const temp = `${target}.download`;
    await RNFS.unlink(temp).catch(() => {});
    const url = (await getArtifactBaseUrl(this.runtime)) + encodeURIComponent(file.name);
    const { promise } = RNFS.downloadFile({
      fromUrl: url,
      toFile: temp,
      progressDivider: 5,
      progress: ({ bytesWritten }) => onProgress?.(Math.min(100, Math.floor((bytesWritten / file.bytes) * 100))),
    });
    try {
      const result = await promise;
      if (result.statusCode !== 200) throw new Error(`Download of ${file.name} failed (HTTP ${result.statusCode})`);
      const stat = await RNFS.stat(temp);
      if (Number(stat.size) !== file.bytes) throw new Error(`${file.name} has the wrong size; the file host does not serve this pool`);
      const digest = (await RNFS.hash(temp, 'sha256')).toLowerCase();
      if (digest !== file.sha256) throw new Error(`${file.name} does not match its pinned hash; it was not kept`);
      await RNFS.unlink(target).catch(() => {});
      await RNFS.moveFile(temp, target);
      return target;
    } catch (error) {
      await RNFS.unlink(temp).catch(() => {});
      throw error;
    }
  }

  /** Download every missing proving file of the instance. */
  async downloadAll(onProgress?: DownloadProgress): Promise<void> {
    const files = this.files();
    let done = 0;
    for (const file of files) {
      await this.ensure(file.name, percent => onProgress?.({ file: file.name, percent, done, total: files.length }));
      done++;
      onProgress?.({ file: file.name, percent: 100, done, total: files.length });
    }
  }

  /**
   * `length` bytes of a proving file from `offset`, base64-encoded as read from
   * disk (the privacy WebView decodes them), downloading the file first if needed.
   */
  async read(name: string, offset: number, length: number, onDownload?: (percent: number) => void): Promise<string> {
    const file = this.pin(name);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0)
      throw new Error('Invalid proving file read');
    const path = await this.ensure(name, onDownload);
    if (offset >= file.bytes) return '';
    return RNFS.read(path, Math.min(length, file.bytes - offset), offset, 'base64');
  }

  /** Delete the instance's proving files (they can be downloaded again). */
  async remove(): Promise<void> {
    await RNFS.unlink(this.dir).catch(() => {});
  }
}
