/**
 * DePIN chat client hook — React Native port of the Neurai web wallet's
 * `useDePINChat`.
 *
 * Talks to a DePIN-enabled Neurai node over JSON-RPC (`depinreceivemsg` /
 * `depinsubmitmsg` / `depinpoolstats` / `checkdepinvalidity` / `depingetmsginfo`)
 * and does all encryption/decryption client-side via `blue_modules/neurai/
 * depinMsg` (ECIES + AES-256-GCM). Messages are polled every 5s (incremental by
 * timestamp) and de-duplicated.
 *
 * Differences from the web wallet:
 *   - The transport is injected as `rpc(method, params)` (built from
 *     `getDepinRpcBackend` by the caller) rather than `wallet.rpc`.
 *   - Identity (address / WIF / pubkey) comes from the dedicated DePIN chat
 *     identity (account 100), not the wallet's address window.
 *   - Private-message recipient mapping is persisted in AsyncStorage instead of
 *     localStorage (hydrated into an in-memory map for synchronous lookups).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NeuraiESP32 } from '@neuraiproject/neurai-sign-esp32/react-native';

import {
  assembleDepinMessage,
  buildDepinMessage,
  buildDepinPreimage,
  decryptDepinReceiveEncryptedPayload,
  type DepinServerWrapResult,
  wrapMessageForServer,
} from '../blue_modules/neurai/depinMsg';
import type { DepinChatIdentity } from '../blue_modules/neurai/depinChatIdentity';

/** Decode a device `plaintext_b64` response to a UTF-8 string. */
const b64ToUtf8 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');

const DEPIN_POLL_INTERVAL_MS = 5_000;
const PRIVATE_MSG_PREFIX = 'depin_private_msg_';

/**
 * Hardware wallets have no local key, so the privacy-wrapped server envelope is
 * forwarded to the device to decrypt — and a full pool dump can exceed what the
 * device accepts (a ~19.6 KB envelope rebooted an ESP32 on older firmware).
 * `depinreceivemsg` supports pagination, so a device-backed identity walks the
 * `after_hash` cursor with a bounded page size, as the firmware's own contract
 * requires ("larger server histories must be paginated by the host").
 * Local-key identities decrypt host-side and still fetch in one shot.
 */
const DEVICE_PAGE_LIMIT = 1;
/** Safety stop so a bogus `has_more` can't spin the cursor forever. */
const MAX_PAGES_PER_POLL = 25;
/** Upper bound for an adaptive page, so one request can't balloon unboundedly. */
const MAX_DEVICE_PAGE_LIMIT = 50;
/**
 * The device reports its ECIES capacity as *decoded binary* bytes
 * (`depin_max_decrypt_bytes` in the ping response). How much of that we can
 * actually use depends on the wire encoding the library negotiates: with the
 * `depin_bulk_decrypt_b64` capability it sends base64 (~4/3 expansion) and the
 * full capacity is reachable; without it, payloads go as hex (2x) and the
 * firmware's incoming-line cap binds first. Library ≥0.5.11 picks the encoding
 * itself and raises RangeError past the limit, so this budget only has to keep
 * pages comfortably below it.
 */
const DEVICE_LEGACY_HEX_CAP_BYTES = 24 * 1024 - 256;
const DEVICE_BULK_B64_CAPABILITY = 'depin_bulk_decrypt_b64';
const DEVICE_BUDGET_SAFETY = 0.7;
/** Consecutive poll failures before polling stops, so a failing device isn't hammered every 5s. */
const MAX_CONSECUTIVE_FAILURES = 4;

/**
 * Decrypted conversations kept per `address|token` for the lifetime of the app
 * process, so leaving a channel and coming back does not re-decrypt everything
 * (each message is a device round-trip on a hardware wallet). Deliberately
 * in-memory: plaintext chat is never written to disk.
 */
interface CachedChannel {
  groupMessages: DePINMessage[];
  privateConversations: Map<string, PrivateConversation>;
  lastTimestamp: number;
  seenKeys: string[];
}
const channelCache = new Map<string, CachedChannel>();

/** A `depinreceivemsg` page: a bare array (no limit) or `{ messages, has_more }` (paginated). */
const normalizePage = (parsed: unknown): { pageItems: DepinReceiveMsgItem[]; hasMore: boolean } => {
  if (Array.isArray(parsed)) return { pageItems: parsed as DepinReceiveMsgItem[], hasMore: false };
  if (parsed && typeof parsed === 'object') {
    const p = parsed as { messages?: unknown; has_more?: unknown };
    if (Array.isArray(p.messages)) return { pageItems: p.messages as DepinReceiveMsgItem[], hasMore: p.has_more === true };
  }
  return { pageItems: [], hasMore: false };
};

/** The RPC client rejects with the raw JSON error object (no `.message`), so dig the real message out. */
const describeRpcError = (err: any): string | null => {
  if (typeof err?.message === 'string' && err.message.length > 0) return err.message;
  const nested = err?.error?.error?.message ?? err?.error?.message;
  if (typeof nested === 'string' && nested.length > 0) return nested;
  return null;
};

const stripAmp = (name: string): string => name.replace(/^&/, '');

/**
 * DePIN asset names start with '&' on-chain, and that full name is what we
 * send to the server by default. Some operators configure their node's token
 * without the prefix though (e.g. the internal test node serves
 * 'TESTDEPIN112025' for asset '&TESTDEPIN112025'), in which case the server
 * rejects with "Token '&X' does not match configured token 'X'". When that
 * happens — and it's clearly the SAME token, just spelled differently — we
 * adopt the server's spelling for subsequent calls instead of erroring out.
 */
const alternateTokenSpelling = (asset: string, err: unknown): string | null => {
  const msg = describeRpcError(err);
  const m = msg?.match(/configured token '([^']+)'/i);
  if (!m) return null;
  const configured = m[1];
  return stripAmp(configured).toUpperCase() === stripAmp(asset).toUpperCase() ? configured : null;
};

export type DepinRpc = <T = unknown>(method: string, params: unknown[]) => Promise<T>;

export interface DePINMessage {
  recipient: string;
  sender: string;
  message: string;
  timestamp: number;
  date: string;
  expires: string;
  messageHash?: string;
  messageType?: 'private' | 'group';
  contactAddress?: string;
}

export interface PrivateConversation {
  address: string;
  displayName: string;
  unreadCount: number;
  lastMessageTime: number;
  messages: DePINMessage[];
}

export interface PoolStats {
  enabled: boolean;
  token: string;
  total_messages: number;
  total_size_bytes: number;
  memory_usage_bytes: number;
  oldest_message?: string;
  newest_message?: string;
  unique_senders: number;
  avg_message_size: number;
  expiring_in_24h: number;
}

export interface AssetValidity {
  has_asset: boolean;
  amount?: number;
  valid?: 0 | 1;
  blocked?: boolean;
}

export interface RecipientInfo {
  address: string;
  pubkey: string | null;
}

interface PubkeyResponse {
  pubkey?: string;
  revealed?: number;
  result?: string | { pubkey?: string };
}

interface DepinReceiveMsgItem {
  hash: string;
  sender: string;
  timestamp: number;
  message_type?: 'private' | 'group';
  encrypted_payload_hex: string;
  signature_hex: string;
}

interface MsgInfoResult {
  depinpoolpkey?: string;
}

const isEncryptedResult = (value: unknown): value is { encrypted: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof (value as { encrypted?: unknown }).encrypted === 'string';
};

const shortAddr = (a: string) => (a.length > 8 ? `${a.substring(0, 4)}…${a.substring(a.length - 4)}` : a);

export function useDePINChat(params: {
  rpc: DepinRpc | null;
  selectedAsset: string | null;
  identity: DepinChatIdentity | null;
  recipientList: RecipientInfo[];
  /** Connected NeuraiHW device — required when `identity.deviceBacked` (no local WIF). */
  device?: NeuraiESP32 | null;
}) {
  const { rpc, selectedAsset, identity, recipientList, device = null } = params;

  // Device-backed identity (hardware wallet): sign/decrypt are routed to the
  // device instead of a local WIF. The device must have an active DePIN session
  // (opened per channel below) for depin_sign / depin_decrypt_payload.
  const deviceBacked = !!identity?.deviceBacked;
  // Can we perform local crypto (has a WIF) OR device crypto (session-backed)?
  const canCrypt = !!identity?.wif || (deviceBacked && !!device);

  const [groupMessages, setGroupMessages] = useState<DePINMessage[]>([]);
  const [privateConversations, setPrivateConversations] = useState<Map<string, PrivateConversation>>(new Map());
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);

  const effectiveAddress = identity?.address ?? null;

  // Mirrors of the message state, so the channel-switch cleanup can stash the
  // latest values without re-running on every incoming message.
  const groupMessagesRef = useRef<DePINMessage[]>([]);
  const privateConversationsRef = useRef<Map<string, PrivateConversation>>(new Map());
  useEffect(() => {
    groupMessagesRef.current = groupMessages;
  }, [groupMessages]);
  useEffect(() => {
    privateConversationsRef.current = privateConversations;
  }, [privateConversations]);

  const lastTimestampRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  // Token spelling the server actually accepts (learned via alternateTokenSpelling).
  const serverTokenRef = useRef<string | null>(null);
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  // Largest envelope seen per message (decoded bytes), used to size the next
  // page. Worst case rather than a mean, so one big message can't overflow it.
  const worstBytesPerMessageRef = useRef<number>(0);
  // A poll now spans many device round-trips and can outlast the 5s tick. Two
  // overlapping polls interleave writes on the one serial line, which corrupts
  // framing (the device answers "Invalid JSON") and mismatches responses, so
  // only one poll may be in flight at a time.
  const pollInFlightRef = useRef(false);
  const recipientPubKeyCacheRef = useRef<Map<string, string | null>>(new Map());
  // In-memory mirror of persisted private-message recipient mapping (hash -> address).
  const privateMsgRecipientsRef = useRef<Map<string, string>>(new Map());

  // Ask the device how much ECIES it can take (`depin_max_decrypt_bytes`, ping).
  // Firmware that predates capability reporting omits it — then we stay on the
  // conservative one-message page instead of guessing.
  const [deviceLimits, setDeviceLimits] = useState<{ maxBytes: number; base64: boolean } | null>(null);
  useEffect(() => {
    if (!deviceBacked || !device) {
      setDeviceLimits(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // The library's typings lag the firmware, which does report these.
        const info = (await device.ping()) as { depin_max_decrypt_bytes?: unknown; capabilities?: unknown };
        const maxBytes = Number(info?.depin_max_decrypt_bytes);
        if (!cancelled && Number.isFinite(maxBytes) && maxBytes > 0) {
          const base64 = Array.isArray(info?.capabilities) && info.capabilities.includes(DEVICE_BULK_B64_CAPABILITY);
          setDeviceLimits({ maxBytes, base64 });
        }
      } catch (e) {
        console.debug('useDePINChat: could not read device decrypt limits', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceBacked, device]);

  // Hydrate the private-message recipient map from AsyncStorage once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const mine = keys.filter(k => k.startsWith(PRIVATE_MSG_PREFIX));
        if (mine.length === 0 || cancelled) return;
        const pairs = await AsyncStorage.multiGet(mine);
        for (const [k, v] of pairs) {
          if (v) privateMsgRecipientsRef.current.set(k.slice(PRIVATE_MSG_PREFIX.length), v);
        }
      } catch (e) {
        console.debug('useDePINChat: failed to hydrate private msg map', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rememberPrivateRecipient = useCallback((hash: string, address: string) => {
    if (!hash || !address) return;
    privateMsgRecipientsRef.current.set(hash, address);
    AsyncStorage.setItem(PRIVATE_MSG_PREFIX + hash, address).catch(() => {});
  }, []);

  const preloadRecipientPubkeys = useCallback(
    async (assetName: string) => {
      if (!assetName || !rpc) return;
      try {
        const data = (await rpc('listdepinaddresses', [serverTokenRef.current ?? assetName])) as Array<{
          address: string;
          pubkey?: string;
        }>;
        for (const item of data ?? []) {
          const pk = (item.pubkey ?? '').trim().toLowerCase();
          if (pk.length === 66 && (pk.startsWith('02') || pk.startsWith('03'))) {
            recipientPubKeyCacheRef.current.set(item.address, pk);
          } else {
            recipientPubKeyCacheRef.current.set(item.address, null);
          }
        }
      } catch (e) {
        console.debug('useDePINChat: preloadRecipientPubkeys failed', e);
      }
    },
    [rpc],
  );

  const resolveRecipientPubkey = useCallback(
    async (address: string, existing: string | null): Promise<string | null> => {
      const normalizedExisting = (existing || '').trim().toLowerCase();
      if (normalizedExisting) return normalizedExisting;

      if (recipientPubKeyCacheRef.current.has(address)) {
        return recipientPubKeyCacheRef.current.get(address) ?? null;
      }
      if (!rpc) return null;

      try {
        const res = (await rpc('getpubkey', [address])) as PubkeyResponse | string | null;
        const revealed = typeof (res as PubkeyResponse)?.revealed === 'number' ? (res as PubkeyResponse).revealed === 1 : null;
        const raw =
          typeof (res as PubkeyResponse)?.pubkey === 'string' ? (res as PubkeyResponse).pubkey! : typeof res === 'string' ? res : '';
        const pk = raw.trim().toLowerCase();

        if (revealed === false) {
          recipientPubKeyCacheRef.current.set(address, null);
          return null;
        }
        if (pk.length === 66 && (pk.startsWith('02') || pk.startsWith('03'))) {
          recipientPubKeyCacheRef.current.set(address, pk);
          return pk;
        }
        recipientPubKeyCacheRef.current.set(address, null);
        return null;
      } catch {
        recipientPubKeyCacheRef.current.set(address, null);
        return null;
      }
    },
    [rpc],
  );

  const getContactAddress = useCallback(
    (messageHash: string, sender: string, myAddr: string, messageType?: 'private' | 'group'): string | undefined => {
      if (messageType !== 'private') return undefined;
      if (sender === myAddr) {
        return privateMsgRecipientsRef.current.get(messageHash) ?? myAddr;
      }
      return sender;
    },
    [],
  );

  // Switching channel: stash what we already decrypted and restore the channel
  // we are entering. Every message costs a device round-trip to decrypt, so
  // re-reading them on each visit made entering the chat slow for no reason.
  useEffect(() => {
    const key = effectiveAddress && selectedAsset ? `${effectiveAddress}|${selectedAsset}` : null;
    const cached = key ? channelCache.get(key) : undefined;

    consecutiveFailuresRef.current = 0;
    serverTokenRef.current = null;
    // Message sizes differ per channel, so recalibrate the page budget.
    worstBytesPerMessageRef.current = 0;
    setError(null);
    setLastPoll(null);
    recipientPubKeyCacheRef.current.clear();

    if (cached) {
      lastTimestampRef.current = cached.lastTimestamp;
      seenMessageKeysRef.current = new Set(cached.seenKeys);
      setGroupMessages(cached.groupMessages);
      setPrivateConversations(new Map(cached.privateConversations));
    } else {
      lastTimestampRef.current = 0;
      seenMessageKeysRef.current = new Set();
      setGroupMessages([]);
      setPrivateConversations(new Map());
    }

    if (selectedAsset) preloadRecipientPubkeys(selectedAsset);

    return () => {
      if (!key) return;
      channelCache.set(key, {
        groupMessages: groupMessagesRef.current,
        privateConversations: privateConversationsRef.current,
        lastTimestamp: lastTimestampRef.current,
        seenKeys: Array.from(seenMessageKeysRef.current),
      });
    };
  }, [selectedAsset, effectiveAddress, preloadRecipientPubkeys]);

  // Device-backed session lifecycle: opening a channel authorizes the device to
  // auto-sign/decrypt on THIS token (one physical approval), scoped to the
  // canonical `&NAME`. The device signs/decrypts only while this is active; the
  // session is revoked on channel close, unmount, disconnect, or timeout.
  const deviceSessionTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deviceBacked || !device) {
      deviceSessionTokenRef.current = null;
      return;
    }
    // Stepping back to the token picker keeps the session: it belongs to the
    // channel, not to the screen, and re-opening it would ask the owner for
    // another physical approval on every navigation.
    if (!selectedAsset) return;
    const token = selectedAsset; // canonical '&NAME' — matches the signed message
    if (deviceSessionTokenRef.current === token) return; // already authorized
    let cancelled = false;
    (async () => {
      try {
        await device.depinSessionBegin(token);
        if (!cancelled) deviceSessionTokenRef.current = token;
      } catch (e) {
        if (!cancelled) {
          deviceSessionTokenRef.current = null;
          setError(describeRpcError(e) ?? 'Could not open the device DePIN session');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceBacked, device, selectedAsset]);

  // Revoke on the way out — leaving the DePIN section entirely (this hook
  // unmounts) or swapping devices, not on in-section navigation.
  useEffect(() => {
    return () => {
      if (device && deviceSessionTokenRef.current) {
        deviceSessionTokenRef.current = null;
        device.depinSessionEnd().catch(() => {});
      }
    };
  }, [device]);

  const ingestItems = useCallback((items: DepinReceiveMsgItem[], myAddr: string, decrypted: DePINMessage[]) => {
    const newGroup: DePINMessage[] = [];
    const privateUpdates = new Map<string, DePINMessage[]>();
    for (const msg of decrypted) {
      if (msg.messageType === 'private' && msg.contactAddress) {
        if (!privateUpdates.has(msg.contactAddress)) privateUpdates.set(msg.contactAddress, []);
        privateUpdates.get(msg.contactAddress)!.push(msg);
      } else {
        newGroup.push(msg);
      }
    }
    if (newGroup.length > 0) {
      setGroupMessages(prev => [...prev, ...newGroup].sort((a, b) => a.timestamp - b.timestamp));
    }
    if (privateUpdates.size > 0) {
      setPrivateConversations(prev => {
        const updated = new Map(prev);
        for (const [contact, msgs] of privateUpdates.entries()) {
          const existing = updated.get(contact);
          const all = existing ? [...existing.messages, ...msgs].sort((a, b) => a.timestamp - b.timestamp) : msgs;
          updated.set(contact, {
            address: contact,
            displayName: contact === myAddr ? 'Me' : shortAddr(contact),
            unreadCount: (existing?.unreadCount || 0) + msgs.length,
            lastMessageTime: Math.max(...all.map(m => m.timestamp)),
            messages: all,
          });
        }
        return updated;
      });
    }
  }, []);

  const pollOnce = useCallback(async () => {
    if (!selectedAsset || !effectiveAddress || !canCrypt || !rpc) return;
    // ECIES decryption: local WIF, or routed to the device (bare-payload verb).
    // Both `depinreceivemsg`'s per-item payload and the privacy-wrapped server
    // envelope are the same ECIES format, so one path handles both.
    const decryptEcies = async (encHex: string, what: string): Promise<{ text: string | null; notForUs: boolean }> => {
      if (!encHex) return { text: null, notForUs: false };
      if (deviceBacked) {
        if (!device) return { text: null, notForUs: false };
        try {
          const { plaintext_b64 } = await device.depinDecryptPayload(encHex);
          return { text: plaintext_b64 ? b64ToUtf8(plaintext_b64) : null, notForUs: false };
        } catch (e) {
          // `not_for_us` is the device saying this identity isn't among the
          // recipients — routine for other members' traffic, not a failure. It
          // must not abort the poll (doing so stalled the whole channel and
          // tripped the failure backoff).
          if (/not_for_us/i.test(String((e as any)?.message ?? e))) {
            console.debug(`useDePINChat: ${what} not addressed to this identity, skipping`);
            return { text: null, notForUs: true };
          }
          throw e;
        }
      }
      return { text: await decryptDepinReceiveEncryptedPayload(encHex, String(identity!.wif)), notForUs: false };
    };

    // `after_hash` / `limit` are positional args 4 and 5, so the timestamp must
    // be sent too (0 = no filter, same as omitting it).
    const callReceive = (token: string, afterHash: string, limit: number) => {
      const rpcParams: (string | number)[] = [token, effectiveAddress, lastTimestampRef.current > 0 ? lastTimestampRef.current : 0];
      if (limit > 0) rpcParams.push(afterHash, limit);
      return rpc('depinreceivemsg', rpcParams);
    };

    // Envelope capacity for one command, in decoded binary bytes: base64
    // firmware reaches its full advertised buffer, hex-only firmware is capped
    // by the serial line instead.
    const budgetBytes = deviceLimits
      ? Math.floor(
          (deviceLimits.base64 ? deviceLimits.maxBytes : Math.min(deviceLimits.maxBytes, DEVICE_LEGACY_HEX_CAP_BYTES)) *
            DEVICE_BUDGET_SAFETY,
        )
      : 0;
    // Local keys fetch everything at once (limit 0). A device pulls one message
    // until it has measured one, then fits as many as the budget allows.
    const nextPageLimit = (): number => {
      if (!deviceBacked) return 0;
      const perMessage = worstBytesPerMessageRef.current;
      if (!budgetBytes || perMessage <= 0) return DEVICE_PAGE_LIMIT;
      return Math.max(1, Math.min(MAX_DEVICE_PAGE_LIMIT, Math.floor(budgetBytes / perMessage)));
    };

    const items: DepinReceiveMsgItem[] = [];
    let afterHash = '';
    let pageLimit = nextPageLimit();

    for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
      let result: unknown;
      try {
        result = await callReceive(serverTokenRef.current ?? selectedAsset, afterHash, pageLimit);
      } catch (err) {
        const alt = alternateTokenSpelling(selectedAsset, err);
        if (!alt) throw err;
        console.debug(`useDePINChat: adopting server token spelling '${alt}' for asset '${selectedAsset}'`);
        serverTokenRef.current = alt;
        result = await callReceive(alt, afterHash, pageLimit);
      }

      let parsed: unknown = result;
      let envelopeHexLen = 0;
      if (isEncryptedResult(result)) {
        envelopeHexLen = result.encrypted.length;
        // Let a decryption failure propagate: with a hardware wallet it means the
        // device rejected or died on the envelope, and the caller's failure
        // counter must see it (swallowing it here looked like an empty pool and
        // retried forever).
        const envelope = await decryptEcies(result.encrypted, 'server envelope');
        parsed = envelope.text ? JSON.parse(envelope.text) : null;
      }

      const { pageItems, hasMore } = normalizePage(parsed);
      items.push(...pageItems);

      // Calibrate from what this page actually cost, so the next one carries as
      // many messages as the device's budget allows.
      if (envelopeHexLen > 0 && pageItems.length > 0) {
        // The envelope travels as hex here, so two chars per decoded byte.
        worstBytesPerMessageRef.current = Math.max(worstBytesPerMessageRef.current, envelopeHexLen / 2 / pageItems.length);
      }

      if (pageLimit === 0 || !hasMore || pageItems.length === 0) break;
      const cursor = String(pageItems[pageItems.length - 1]?.hash ?? '');
      if (!cursor || cursor === afterHash) break;
      afterHash = cursor;
      pageLimit = nextPageLimit();
    }

    let maxTimestamp = lastTimestampRef.current;
    const decrypted: DePINMessage[] = [];
    const seen = seenMessageKeysRef.current;

    for (const item of items) {
      if (typeof item?.timestamp === 'number') maxTimestamp = Math.max(maxTimestamp, item.timestamp);
      const key = `${String(item?.hash ?? '')}|${String(item?.signature_hex ?? '')}`;
      if (!item?.hash || seen.has(key)) continue;

      let plaintext: string | null = null;
      let notForUs = false;
      try {
        const res = await decryptEcies(String(item.encrypted_payload_hex ?? ''), `message ${String(item.hash ?? '').slice(0, 8)}`);
        plaintext = res.text;
        notForUs = res.notForUs;
      } catch {
        plaintext = null;
      }
      // A message addressed to someone else never becomes readable, so retire it
      // instead of re-decrypting it on the device every 5s. `seen` is cleared
      // when the channel or identity changes, so this is not permanent.
      if (notForUs) {
        seen.add(key);
        continue;
      }
      if (typeof plaintext !== 'string' || plaintext.length === 0) continue;

      seen.add(key);
      const ts = typeof item.timestamp === 'number' ? item.timestamp : Math.floor(Date.now() / 1000);
      const messageHash = String(item.hash ?? '');
      const sender = String(item.sender ?? '');
      // Some clients send private messages as plain "@recipient text" without
      // tagging message_type — route those to the private conversation (and
      // strip the prefix) instead of showing them raw in the group chat.
      const privMatch = plaintext.match(/^@(N[a-zA-Z0-9]{33,34}|t[a-zA-Z0-9]{33,34})\s+([\s\S]*)$/);
      const messageType = privMatch ? 'private' : item.message_type;
      let contactAddress = getContactAddress(messageHash, sender, effectiveAddress, messageType);
      if (privMatch && sender === effectiveAddress) contactAddress = privMatch[1];
      decrypted.push({
        recipient: effectiveAddress,
        sender,
        message: privMatch ? privMatch[2] : plaintext,
        timestamp: ts,
        date: new Date(ts * 1000).toLocaleString(),
        expires: '',
        messageHash,
        messageType,
        contactAddress,
      });
    }

    lastTimestampRef.current = maxTimestamp;
    if (decrypted.length > 0) ingestItems(items, effectiveAddress, decrypted);
    setLastPoll(new Date());
  }, [rpc, selectedAsset, effectiveAddress, identity, getContactAddress, ingestItems, deviceBacked, device, canCrypt, deviceLimits]);

  // Automatic polling every 5s while connected.
  useEffect(() => {
    if (!selectedAsset || !effectiveAddress || !isPolling || !rpc) return;
    let active = true;

    const run = async () => {
      if (pollInFlightRef.current) return; // previous cycle still talking to the device
      pollInFlightRef.current = true;
      try {
        await pollOnce();
        if (active) {
          consecutiveFailuresRef.current = 0;
          setError(null);
        }
      } catch (err: any) {
        console.warn('useDePINChat: poll failed:', describeRpcError(err) ?? err);
        // The first poll right after selecting a token often races a cold RPC
        // connection; polling keeps retrying every 5s, so only surface an error
        // after it fails repeatedly (the UI shows a "checking…" state meanwhile).
        consecutiveFailuresRef.current += 1;
        if (active && consecutiveFailuresRef.current >= 2) {
          setError(describeRpcError(err) ?? 'Failed to fetch messages');
        }
        // Give up after repeated failures instead of retrying forever: when the
        // failure is a hardware wallet that can't answer, each retry hits the
        // device again. Re-entering the channel restarts polling.
        if (active && consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          console.warn('useDePINChat: polling stopped after repeated failures');
          setIsPolling(false);
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    run();
    const interval = setInterval(run, DEPIN_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [rpc, selectedAsset, effectiveAddress, isPolling, pollOnce]);

  const refreshMessages = useCallback(async () => {
    try {
      await pollOnce();
      setError(null);
    } catch (err: any) {
      console.debug('useDePINChat: manual refresh failed', err?.message ?? err);
    }
  }, [pollOnce]);

  const fetchStats = useCallback(async (): Promise<PoolStats | null> => {
    if (!rpc) return null;
    try {
      const result = (await rpc('depinpoolstats', [])) as PoolStats;
      setStats(result);
      return result;
    } catch (e) {
      console.debug('useDePINChat: depinpoolstats failed', e);
      return null;
    }
  }, [rpc]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!selectedAsset || !effectiveAddress || !identity?.publicKey || !canCrypt) {
        throw new Error('DePIN chat not ready');
      }
      if (!rpc) throw new Error('No DePIN RPC backend');

      const privateMatch = message.match(/^@(N[a-zA-Z0-9]{33,34}|t[a-zA-Z0-9]{33,34})\s+([\s\S]*)$/);
      const isPrivate = !!privateMatch;
      const targetAddress = isPrivate ? privateMatch![1] : null;
      const cleaned = isPrivate ? privateMatch![2] : message;

      const senderPubKey = String(identity.publicKey).trim().toLowerCase();

      const recipientPubKeys: string[] = [];
      if (isPrivate && targetAddress) {
        const target = recipientList.find(r => r.address === targetAddress);
        if (!target) throw new Error(`Recipient ${targetAddress} does not hold ${selectedAsset}`);
        const pk = await resolveRecipientPubkey(target.address, target.pubkey ?? null);
        if (!pk) throw new Error(`No public key for ${targetAddress}`);
        recipientPubKeys.push(pk);
      } else {
        const set = new Set<string>();
        for (const r of recipientList) {
          const pk = await resolveRecipientPubkey(r.address, r.pubkey ?? null);
          if (pk && !set.has(pk)) {
            set.add(pk);
            recipientPubKeys.push(pk);
          }
        }
      }
      if (recipientPubKeys.length === 0) throw new Error('No valid recipient public keys found');

      const messageType: 'private' | 'group' = isPrivate ? 'private' : 'group';
      const timestamp = Math.floor(Date.now() / 1000);

      let built;
      if (deviceBacked) {
        // Hardware wallet: encrypt host-side (no key), sign on the device, then
        // assemble. The device session is scoped to the canonical `&NAME`, so we
        // sign/assemble/submit with that same token (matches node verification).
        if (!device) throw new Error('Device not connected');
        const token = selectedAsset;
        if (deviceSessionTokenRef.current !== token) {
          throw new Error('Device DePIN session not active for this channel');
        }
        const pre = await buildDepinPreimage({
          token,
          senderAddress: effectiveAddress,
          senderPubKey,
          timestamp,
          message: cleaned,
          recipientPubKeys,
          messageType,
        });
        const { signature } = await device.depinSign({
          token,
          sender: effectiveAddress,
          timestamp,
          messageType: pre.messageTypeByte,
          encryptedPayload: pre.encryptedPayloadHex,
        });
        built = await assembleDepinMessage(
          { token, senderAddress: effectiveAddress, timestamp, messageType, encryptedPayloadHex: pre.encryptedPayloadHex },
          signature,
        );
      } else {
        built = await buildDepinMessage({
          token: serverTokenRef.current ?? selectedAsset,
          senderAddress: effectiveAddress,
          senderPubKey,
          privateKey: String(identity.wif),
          timestamp,
          message: cleaned,
          recipientPubKeys,
          messageType,
        });
      }

      let payload: string | DepinServerWrapResult = built.hex;
      try {
        const info = (await rpc('depingetmsginfo', [])) as MsgInfoResult;
        if (info?.depinpoolpkey && info.depinpoolpkey !== '0') {
          payload = await wrapMessageForServer(built.hex, info.depinpoolpkey, effectiveAddress);
        }
      } catch (e) {
        console.debug('useDePINChat: server privacy layer check failed', e);
      }

      const result = await rpc('depinsubmitmsg', [payload]);

      if (isPrivate && targetAddress) {
        rememberPrivateRecipient(built.messageHash, targetAddress);
        if (typeof result === 'string' && result !== built.messageHash) rememberPrivateRecipient(result, targetAddress);
      }
      return result;
    },
    [
      rpc,
      selectedAsset,
      effectiveAddress,
      identity,
      recipientList,
      resolveRecipientPubkey,
      rememberPrivateRecipient,
      deviceBacked,
      device,
      canCrypt,
    ],
  );

  const checkAssetValidity = useCallback(async (): Promise<AssetValidity | null> => {
    if (!selectedAsset || !effectiveAddress || !rpc) return null;
    try {
      return (await rpc('checkdepinvalidity', [selectedAsset, effectiveAddress])) as AssetValidity;
    } catch (e) {
      console.debug('useDePINChat: checkdepinvalidity failed', e);
      return null;
    }
  }, [rpc, selectedAsset, effectiveAddress]);

  const createPrivateConversation = useCallback(
    (address: string) => {
      setPrivateConversations(prev => {
        if (prev.has(address)) return prev;
        const updated = new Map(prev);
        updated.set(address, {
          address,
          displayName: address === effectiveAddress ? 'Me' : shortAddr(address),
          unreadCount: 0,
          lastMessageTime: Math.floor(Date.now() / 1000),
          messages: [],
        });
        return updated;
      });
    },
    [effectiveAddress],
  );

  return {
    groupMessages,
    privateConversations,
    isPolling,
    setIsPolling,
    error,
    stats,
    lastPoll,
    sendMessage,
    refreshMessages,
    fetchStats,
    checkAssetValidity,
    createPrivateConversation,
  };
}
