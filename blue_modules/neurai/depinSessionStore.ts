/**
 * Secure storage for the DePIN chat session key (firmware protocol v2).
 *
 * `depin_session_begin` asks the device owner for a physical approval and hands
 * back a 128-bit capability key; every later `depin_sign` / `depin_decrypt*`
 * must present it. Keeping that key across app restarts is what lets us call
 * `depin_session_status` and skip a redundant approval when the device is still
 * in DePIN mode — without it the host has no way to know the session is live.
 *
 * The key is a credential: it is stored with the same secure backend the wallet
 * uses for its own secrets (hardware-backed Keystore/Keychain, not backed up
 * and not migrated to another device), scoped to the DePIN address, and never
 * logged. It is short-lived by construction — the firmware expires it after 15
 * minutes idle and one hour absolute.
 */
import RNSecureKeyStore, { ACCESSIBLE } from 'react-native-secure-key-store';

const KEY_PREFIX = 'depin_session_';

export interface StoredDepinSession {
  /** Capability key returned by `depin_session_begin`, hex. */
  key: string;
  /** Channel the session was opened for, canonical `&NAME`. */
  token: string;
}

const storageKey = (address: string): string => `${KEY_PREFIX}${address}`;

/** Persist the session key for a DePIN address. Failures are non-fatal (we just re-authorize). */
export async function saveDepinSession(address: string, session: StoredDepinSession): Promise<void> {
  if (!address || !session.key) return;
  try {
    await RNSecureKeyStore.set(storageKey(address), JSON.stringify(session), {
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (e) {
    // Never log the key itself.
    console.debug('depinSessionStore: could not persist session key');
  }
}

/** Read back a stored session, or null when there is none (the store throws when the key is absent). */
export async function loadDepinSession(address: string): Promise<StoredDepinSession | null> {
  if (!address) return null;
  try {
    const raw = await RNSecureKeyStore.get(storageKey(address));
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDepinSession>;
    if (typeof parsed?.key === 'string' && typeof parsed?.token === 'string' && parsed.key.length > 0) {
      return { key: parsed.key, token: parsed.token };
    }
  } catch {
    // Absent or unreadable — treat as "no session", the caller re-authorizes.
  }
  return null;
}

/** Drop the stored session (expired, rejected by the device, or channel changed). */
export async function clearDepinSession(address: string): Promise<void> {
  if (!address) return;
  try {
    await RNSecureKeyStore.remove(storageKey(address));
  } catch {
    // Already gone.
  }
}
