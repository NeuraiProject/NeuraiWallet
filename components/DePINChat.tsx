/**
 * DePIN chat tab — token-gated messaging over a DePIN-enabled Neurai node.
 *
 * Rendered inside `WalletTransactions` when the "DePIN" tab is selected (Legacy
 * wallets only). Derives the dedicated DePIN chat identity (account 100), lists
 * the DePIN tokens held at that address, and — once a token is selected — opens
 * an end-to-end encrypted group/private chat with the other holders via
 * `react-native-gifted-chat` and the `useDePINChat` hook.
 *
 * The gear button opens `DepinRpcEdit` to point the chat at a specific DePIN
 * node. To receive group messages the address's public key must be on-chain, so
 * when it isn't we offer a "reveal" action that burns a little XNA from the
 * DePIN address (mirrors the web wallet).
 *
 * Mirrors the Neurai web wallet's `Chat.tsx` / `useDePINChat.ts`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, InteractionManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import Clipboard from '@react-native-clipboard/clipboard';
import { useFocusEffect } from '@react-navigation/native';

import { getDepinRpcBackend, type NeuraiBackend, type NeuraiNetwork } from '../blue_modules/neurai';
import { deriveDepinChatIdentity, type DepinChatIdentity, isDepinChatSupportedNetwork } from '../blue_modules/neurai/depinChatIdentity';
import { isNeuraiWallet } from '../class/wallets/is-neurai-wallet';
import { useDePINChat, type RecipientInfo } from '../hooks/useDePINChat';
import useWalletSubscribe from '../hooks/useWalletSubscribe';
import { useExtendedNavigation } from '../hooks/useExtendedNavigation';
import loc from '../loc';
import presentAlert from './Alert';
import QRCode from './QRCode';
import { useTheme } from './themes';

interface DePINChatProps {
  walletID: string;
}

const ONE_COIN = 1e8;
const REVEAL_AMOUNT_XNA = 0.1;
const PUBKEY_POLL_MS = 25_000;
const BURN_ADDRESS: Record<NeuraiNetwork, string> = {
  mainnet: 'NbURNXXXXXXXXXXXXXXXXXXXXXXXT65Gdr',
  testnet: 'tBURNXXXXXXXXXXXXXXXXXXXXXXXVZLroy',
};

const shortAddr = (a: string) => (a.length > 10 ? `${a.substring(0, 5)}…${a.substring(a.length - 5)}` : a);

const parseRevealed = (res: unknown): boolean | null => {
  if (res && typeof res === 'object') {
    const r = res as { revealed?: number; pubkey?: string };
    if (typeof r.revealed === 'number') return r.revealed === 1;
    if (typeof r.pubkey === 'string' && /^0[23][0-9a-f]{64}$/i.test(r.pubkey.trim())) return true;
  }
  if (typeof res === 'string' && /^0[23][0-9a-f]{64}$/i.test(res.trim())) return true;
  return null;
};

const normalizeAmount = (raw: unknown): number => {
  if (typeof raw === 'number') return raw > 1e6 ? raw / ONE_COIN : raw;
  const n = Number(raw);
  return Number.isFinite(n) ? (n > 1e6 ? n / ONE_COIN : n) : 0;
};

const DePINChat: React.FC<DePINChatProps> = ({ walletID }) => {
  const { colors } = useTheme();
  const { navigate } = useExtendedNavigation();
  const wallet = useWalletSubscribe(walletID);
  const neurai = isNeuraiWallet(wallet) ? wallet : null;

  const network: NeuraiNetwork = neurai ? neurai.getNeuraiNetwork() : 'mainnet';
  const chainType = neurai ? neurai.network : 'xna';
  const supported = !!neurai && isDepinChatSupportedNetwork(chainType);

  const identity = useMemo<DepinChatIdentity | null>(() => {
    if (!neurai || !supported || !neurai.secret) return null;
    try {
      return deriveDepinChatIdentity({ network: chainType as 'xna' | 'xna-test', mnemonic: neurai.secret, passphrase: neurai.passphrase });
    } catch (e) {
      console.debug('DePINChat: failed to derive chat identity', e);
      return null;
    }
  }, [neurai, supported, chainType]);

  const backendRef = useRef<NeuraiBackend | null>(null);
  const rpc = useMemo(() => {
    if (!supported) return null;
    return <T = unknown,>(method: string, params: unknown[]): Promise<T> => {
      if (!backendRef.current) backendRef.current = getDepinRpcBackend(network);
      return backendRef.current.rpc<T>(method, params);
    };
  }, [supported, network]);

  const [chatAssets, setChatAssets] = useState<Record<string, number>>({});
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [recipientList, setRecipientList] = useState<RecipientInfo[]>([]);
  const [pubkeyRevealed, setPubkeyRevealed] = useState<boolean | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('group');
  const [showQr, setShowQr] = useState(false);

  const { groupMessages, privateConversations, error, sendMessage, checkAssetValidity, setIsPolling } = useDePINChat({
    rpc,
    selectedAsset,
    identity,
    recipientList,
  });

  // Load the DePIN tokens held at the chat address.
  const loadAssets = useCallback(async () => {
    if (!rpc || !identity) return;
    setLoadingAssets(true);
    try {
      const balances = (await rpc('listassetbalancesbyaddress', [identity.address])) as Record<string, unknown> | null;
      const next: Record<string, number> = {};
      if (balances && typeof balances === 'object') {
        for (const name of Object.keys(balances)) {
          if (name === 'XNA') continue;
          const amount = normalizeAmount(balances[name]);
          if (amount > 0) next[name] = amount;
        }
      }
      setChatAssets(next);
    } catch (e) {
      console.debug('DePINChat: listassetbalancesbyaddress failed', e);
    } finally {
      setLoadingAssets(false);
    }
  }, [rpc, identity]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadAssets();
      });
      return () => task.cancel();
    }, [loadAssets]),
  );

  // Poll getpubkey(chatAddress) until the public key is revealed on-chain.
  useEffect(() => {
    if (!rpc || !identity || pubkeyRevealed === true) return;
    let cancelled = false;
    const checkOnce = async () => {
      try {
        const res = await rpc('getpubkey', [identity.address]);
        if (!cancelled) setPubkeyRevealed(parseRevealed(res));
      } catch {
        if (!cancelled) setPubkeyRevealed(null);
      }
    };
    checkOnce();
    const interval = setInterval(checkOnce, PUBKEY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rpc, identity, pubkeyRevealed]);

  // When a token is selected: load recipients + verify validity + start polling.
  const selectAsset = useCallback(
    async (assetName: string) => {
      if (!rpc) return;
      setSelectedAsset(assetName);
      setActiveTab('group');
      setIsPolling(true);
      try {
        const [depinAddrs, byAsset] = await Promise.all([
          rpc('listdepinaddresses', [assetName]) as Promise<Array<{ address: string; pubkey?: string }>>,
          rpc('listaddressesbyasset', [assetName]) as Promise<Record<string, unknown>>,
        ]);
        const pubkeyByAddr = new Map<string, string>();
        for (const item of depinAddrs ?? []) if (item.pubkey) pubkeyByAddr.set(item.address, item.pubkey);
        const list: RecipientInfo[] = Object.keys(byAsset ?? {}).map(address => ({
          address,
          pubkey: pubkeyByAddr.get(address) ?? null,
        }));
        setRecipientList(list);
      } catch (e) {
        console.debug('DePINChat: failed to load recipients', e);
      }
      checkAssetValidity();
    },
    [rpc, setIsPolling, checkAssetValidity],
  );

  const handleReveal = useCallback(async () => {
    if (!neurai || !identity || revealing || !rpc) return;
    setRevealing(true);
    try {
      const utxos = await getDepinRpcBackend(network).getUtxos([identity.address]);
      const { signedHex } = await neurai.buildDepinPubkeyRevealTransaction({
        depinAddress: identity.address,
        depinWif: identity.wif,
        utxos,
        burnAddress: BURN_ADDRESS[network],
        amountSats: Math.round(REVEAL_AMOUNT_XNA * ONE_COIN),
      });
      const backend = backendRef.current ?? getDepinRpcBackend(network);
      await backend.broadcast(signedHex);
      presentAlert({ message: loc.depin.reveal_waiting });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const isFunds = /insufficient|funds|cover/i.test(msg);
      presentAlert({
        message: isFunds
          ? loc.formatString(loc.depin.reveal_need_funds, { amount: REVEAL_AMOUNT_XNA, ticker: 'XNA' })
          : loc.depin.reveal_failed,
      });
    } finally {
      setRevealing(false);
    }
  }, [neurai, identity, revealing, rpc, network]);

  const copyAddress = useCallback(() => {
    if (!identity) return;
    Clipboard.setString(identity.address);
    presentAlert({ message: loc.depin.address_copied });
  }, [identity]);

  const messages = useMemo<IMessage[]>(() => {
    const src = activeTab === 'group' ? groupMessages : (privateConversations.get(activeTab)?.messages ?? []);
    return src
      .map((m, i) => ({
        _id: `${m.messageHash ?? m.sender}-${m.timestamp}-${i}`,
        text: m.message,
        createdAt: new Date(m.timestamp * 1000),
        user: { _id: m.sender, name: shortAddr(m.sender) },
      }))
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [activeTab, groupMessages, privateConversations]);

  const onSend = useCallback(
    (msgs: IMessage[] = []) => {
      const text = (msgs[0]?.text ?? '').trim();
      if (!text) return;
      const payload = activeTab === 'group' ? text : `@${activeTab} ${text}`;
      sendMessage(payload).catch((e: any) => presentAlert({ message: e?.message ?? loc.depin.send_failed }));
    },
    [activeTab, sendMessage],
  );

  const stylesHook = {
    root: { backgroundColor: colors.background },
    text: { color: colors.foregroundColor },
    subtext: { color: colors.alternativeTextColor },
    card: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
    chip: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
    chipActive: { backgroundColor: colors.elevated, borderColor: colors.foregroundColor },
    chipText: { color: colors.foregroundColor },
    banner: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
  };

  const gearButton = (
    <Pressable
      onPress={() => navigate('DepinRpcEdit', { network })}
      style={styles.gear}
      accessibilityLabel={loc.depin.config}
      testID="DepinChatConfig"
    >
      <Text style={[styles.gearGlyph, stylesHook.subtext]}>⚙</Text>
    </Pressable>
  );

  if (!neurai || !supported) {
    return (
      <View style={[styles.center, stylesHook.root]}>
        <Text style={[styles.info, stylesHook.subtext]}>{loc.depin.not_supported_pq}</Text>
      </View>
    );
  }

  if (!identity) {
    return (
      <View style={[styles.center, stylesHook.root]}>
        <ActivityIndicator />
      </View>
    );
  }

  const assetNames = Object.keys(chatAssets);
  const addressRow = (
    <View style={[styles.addressCard, stylesHook.card]}>
      <Text style={[styles.addressLabel, stylesHook.subtext]}>{loc.depin.address_label}</Text>
      <Text style={[styles.addressText, stylesHook.text]} numberOfLines={1} ellipsizeMode="middle" selectable>
        {identity.address}
      </Text>
      <View style={styles.addressActions}>
        <Pressable onPress={copyAddress} style={[styles.smallBtn, stylesHook.chip]} testID="DepinCopyAddress">
          <Text style={[styles.smallBtnText, stylesHook.chipText]}>{loc.depin.copy}</Text>
        </Pressable>
        <Pressable onPress={() => setShowQr(v => !v)} style={[styles.smallBtn, stylesHook.chip]}>
          <Text style={[styles.smallBtnText, stylesHook.chipText]}>{loc.depin.show_qr}</Text>
        </Pressable>
      </View>
      {showQr && (
        <View style={styles.qrWrap}>
          <QRCode value={identity.address} size={180} />
        </View>
      )}
      <Text style={[styles.hint, stylesHook.subtext]}>{loc.formatString(loc.depin.deposit_hint, { ticker: 'XNA' })}</Text>
    </View>
  );

  const revealBanner = pubkeyRevealed === false && (
    <View style={[styles.banner, stylesHook.banner]}>
      <Text style={[styles.bannerTitle, stylesHook.text]}>{loc.depin.reveal_title}</Text>
      <Text style={[styles.bannerDesc, stylesHook.subtext]}>
        {loc.formatString(loc.depin.reveal_desc, { amount: REVEAL_AMOUNT_XNA, ticker: 'XNA' })}
      </Text>
      <Pressable onPress={handleReveal} disabled={revealing} style={[styles.revealBtn, stylesHook.chipActive]} testID="DepinRevealPubkey">
        {revealing ? (
          <ActivityIndicator />
        ) : (
          <Text style={[styles.revealBtnText, stylesHook.text]}>
            {loc.formatString(loc.depin.reveal_button, { amount: REVEAL_AMOUNT_XNA, ticker: 'XNA' })}
          </Text>
        )}
      </Pressable>
    </View>
  );

  // No token selected yet — show picker, address/QR and any reveal prompt.
  if (!selectedAsset) {
    return (
      <ScrollView style={[styles.flex, stylesHook.root]} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, stylesHook.text]}>{loc.depin.title}</Text>
          {gearButton}
        </View>

        {loadingAssets && assetNames.length === 0 ? (
          <ActivityIndicator style={styles.loader} />
        ) : assetNames.length === 0 ? (
          <Text style={[styles.info, stylesHook.subtext]}>{loc.depin.no_token}</Text>
        ) : (
          <>
            <Text style={[styles.sectionLabel, stylesHook.subtext]}>{loc.depin.select_asset}</Text>
            <View style={styles.chipsWrap}>
              {assetNames.map(name => (
                <Pressable
                  key={name}
                  onPress={() => selectAsset(name)}
                  style={[styles.chip, stylesHook.chip]}
                  testID={`DepinAsset-${name}`}
                >
                  <Text style={[styles.chipText, stylesHook.chipText]}>{name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {revealBanner}
        {addressRow}
      </ScrollView>
    );
  }

  const privateTabs = Array.from(privateConversations.values()).sort((a, b) => b.lastMessageTime - a.lastMessageTime);

  return (
    <KeyboardProvider>
      <View style={[styles.flex, stylesHook.root]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => setSelectedAsset(null)} style={styles.backBtn}>
            <Text style={[styles.title, stylesHook.text]} numberOfLines={1}>
              {`# ${selectedAsset}`}
            </Text>
          </Pressable>
          {gearButton}
        </View>

        <View style={styles.tabsRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
            <Pressable
              onPress={() => setActiveTab('group')}
              style={[styles.tabChip, activeTab === 'group' ? stylesHook.chipActive : stylesHook.chip]}
            >
              <Text style={[styles.chipText, stylesHook.chipText]}>{loc.depin.tab_group}</Text>
            </Pressable>
            {privateTabs.map(c => (
              <Pressable
                key={c.address}
                onPress={() => setActiveTab(c.address)}
                style={[styles.tabChip, activeTab === c.address ? stylesHook.chipActive : stylesHook.chip]}
              >
                <Text style={[styles.chipText, stylesHook.chipText]}>{c.displayName}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {revealBanner}
        {error ? <Text style={[styles.errorText, stylesHook.subtext]}>{error}</Text> : null}

        <View style={styles.flex}>
          <GiftedChat
            messages={messages}
            onSend={onSend}
            user={{ _id: identity.address }}
            textInputProps={{
              placeholder: activeTab === 'group' ? loc.depin.input_placeholder : loc.depin.input_placeholder_private,
              placeholderTextColor: colors.alternativeTextColor,
            }}
            messagesContainerStyle={stylesHook.root}
          />
        </View>
      </View>
    </KeyboardProvider>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 16, paddingBottom: 120 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { flex: 1, marginRight: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  gear: { padding: 8 },
  gearGlyph: { fontSize: 20 },
  info: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  loader: { marginVertical: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: '600' },
  tabsRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  tabsContent: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  tabChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  addressCard: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1 },
  addressLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  addressText: { fontSize: 14, fontWeight: '600' },
  addressActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  smallBtnText: { fontSize: 13, fontWeight: '600' },
  qrWrap: { alignItems: 'center', marginTop: 14 },
  hint: { fontSize: 12, marginTop: 10, lineHeight: 18 },
  banner: { margin: 16, padding: 14, borderRadius: 12, borderWidth: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  bannerDesc: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  revealBtn: { paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  revealBtnText: { fontSize: 14, fontWeight: '700' },
  errorText: { fontSize: 12, textAlign: 'center', paddingVertical: 6 },
});

export default DePINChat;
