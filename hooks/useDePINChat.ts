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
  unwrapMessageFromServer,
  wrapMessageForServer,
} from '../blue_modules/neurai/depinMsg';
import type { DepinChatIdentity } from '../blue_modules/neurai/depinChatIdentity';

/** Decode a device `plaintext_b64` response to a UTF-8 string. */
const b64ToUtf8 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');

const DEPIN_POLL_INTERVAL_MS = 5_000;
const PRIVATE_MSG_PREFIX = 'depin_private_msg_';

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

  const lastTimestampRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  // Token spelling the server actually accepts (learned via alternateTokenSpelling).
  const serverTokenRef = useRef<string | null>(null);
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  const recipientPubKeyCacheRef = useRef<Map<string, string | null>>(new Map());
  // In-memory mirror of persisted private-message recipient mapping (hash -> address).
  const privateMsgRecipientsRef = useRef<Map<string, string>>(new Map());

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

  // Reset incremental polling + dedupe on token/address change; preload pubkeys.
  useEffect(() => {
    lastTimestampRef.current = 0;
    consecutiveFailuresRef.current = 0;
    serverTokenRef.current = null;
    seenMessageKeysRef.current = new Set();
    setGroupMessages([]);
    setPrivateConversations(new Map());
    setError(null);
    setLastPoll(null);
    recipientPubKeyCacheRef.current.clear();
    if (selectedAsset) preloadRecipientPubkeys(selectedAsset);
  }, [selectedAsset, effectiveAddress, preloadRecipientPubkeys]);

  // Device-backed session lifecycle: opening a channel authorizes the device to
  // auto-sign/decrypt on THIS token (one physical approval), scoped to the
  // canonical `&NAME`. The device signs/decrypts only while this is active; the
  // session is revoked on channel close, unmount, disconnect, or timeout.
  const deviceSessionTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deviceBacked || !device || !selectedAsset) {
      deviceSessionTokenRef.current = null;
      return;
    }
    const token = selectedAsset; // canonical '&NAME' — matches the signed message
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
      deviceSessionTokenRef.current = null;
      device.depinSessionEnd().catch(() => {});
    };
  }, [deviceBacked, device, selectedAsset]);

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
    const decryptEcies = async (encHex: string): Promise<string | null> => {
      if (!encHex) return null;
      if (deviceBacked) {
        if (!device) return null;
        const { plaintext_b64 } = await device.depinDecryptPayload(encHex);
        return plaintext_b64 ? b64ToUtf8(plaintext_b64) : null;
      }
      return decryptDepinReceiveEncryptedPayload(encHex, String(identity!.wif));
    };

    const callReceive = (token: string) => {
      const rpcParams: (string | number)[] = [token, effectiveAddress];
      if (lastTimestampRef.current > 0) rpcParams.push(lastTimestampRef.current);
      return rpc('depinreceivemsg', rpcParams);
    };

    let result: unknown;
    try {
      result = await callReceive(serverTokenRef.current ?? selectedAsset);
    } catch (err) {
      const alt = alternateTokenSpelling(selectedAsset, err);
      if (!alt) throw err;
      console.debug(`useDePINChat: adopting server token spelling '${alt}' for asset '${selectedAsset}'`);
      serverTokenRef.current = alt;
      result = await callReceive(alt);
    }

    let items: DepinReceiveMsgItem[] = [];
    if (isEncryptedResult(result)) {
      try {
        const json = await decryptEcies(result.encrypted);
        if (json) items = JSON.parse(json);
      } catch (e) {
        console.debug('useDePINChat: failed to parse decrypted server response', e);
      }
    } else {
      items = Array.isArray(result) ? (result as DepinReceiveMsgItem[]) : [];
    }

    let maxTimestamp = lastTimestampRef.current;
    const decrypted: DePINMessage[] = [];
    const seen = seenMessageKeysRef.current;

    for (const item of items) {
      if (typeof item?.timestamp === 'number') maxTimestamp = Math.max(maxTimestamp, item.timestamp);
      const key = `${String(item?.hash ?? '')}|${String(item?.signature_hex ?? '')}`;
      if (!item?.hash || seen.has(key)) continue;

      let plaintext: string | null = null;
      try {
        plaintext = await decryptEcies(String(item.encrypted_payload_hex ?? ''));
      } catch {
        plaintext = null;
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
  }, [rpc, selectedAsset, effectiveAddress, identity, getContactAddress, ingestItems, deviceBacked, device, canCrypt]);

  // Automatic polling every 5s while connected.
  useEffect(() => {
    if (!selectedAsset || !effectiveAddress || !isPolling || !rpc) return;
    let active = true;

    const run = async () => {
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
    [rpc, selectedAsset, effectiveAddress, identity, recipientList, resolveRecipientPubkey, rememberPrivateRecipient, deviceBacked, device, canCrypt],
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
