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
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NeuraiNetwork } from '../blue_modules/neurai';
import { isDepinChatSupportedNetwork } from '../blue_modules/neurai/depinChatIdentity';
import { isNeuraiWallet } from '../class/wallets/is-neurai-wallet';
import { useDePINChat, type RecipientInfo } from '../hooks/useDePINChat';
import useDepinChatIdentity from '../hooks/useDepinChatIdentity';
import useDepinChatKeyboard from '../hooks/useDepinChatKeyboard';
import useDepinChatReadyState from '../hooks/useDepinChatReadyState';
import useDepinChatSetup from '../hooks/useDepinChatSetup';
import useWalletSubscribe from '../hooks/useWalletSubscribe';
import { useExtendedNavigation } from '../hooks/useExtendedNavigation';
import loc from '../loc';
import presentAlert from './Alert';
import Icon from './Icon';
import { useTheme } from './themes';
import { BURN_ADDRESS, FUND_AMOUNT_XNA, ONE_COIN, REVEAL_AMOUNT_XNA, REVEAL_RETRY_MS } from './depinChat/constants';
import DepinChatAddressCard from './depinChat/DepinChatAddressCard';
import DepinChatContactsDrawer from './depinChat/DepinChatContactsDrawer';
import DepinChatInfoModal from './depinChat/DepinChatInfoModal';
import DepinChatRevealBanner from './depinChat/DepinChatRevealBanner';
import DepinChatTokenSections from './depinChat/DepinChatTokenSections';
import type { DePINChatHandle, DePINChatProps } from './depinChat/types';
import { shortAddr } from './depinChat/utils';

export type { DePINChatHandle } from './depinChat/types';

const DePINChat = forwardRef<DePINChatHandle, DePINChatProps>(({ walletID }, ref) => {
  const { colors } = useTheme();
  const { navigate } = useExtendedNavigation();
  const insets = useSafeAreaInsets();
  const wallet = useWalletSubscribe(walletID);
  const neurai = isNeuraiWallet(wallet) ? wallet : null;

  const network: NeuraiNetwork = neurai ? neurai.getNeuraiNetwork() : 'mainnet';
  const chainType = neurai ? neurai.network : 'xna';
  const supported = !!neurai && isDepinChatSupportedNetwork(chainType);

  const secret = neurai?.secret ?? '';
  const passphrase = neurai?.passphrase ?? '';
  const identity = useDepinChatIdentity({ chainType, passphrase, secret, supported });

  const { chatAssets, depinBalance, getBackend, loadingAssets, pubkeyRevealed, refreshServerInfo, rpc, serverInfo } = useDepinChatSetup({
    identity,
    network,
    supported,
  });
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [recipientList, setRecipientList] = useState<RecipientInfo[]>([]);
  const [revealing, setRevealing] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const revealRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (revealRetryTimerRef.current) clearTimeout(revealRetryTimerRef.current);
    };
  }, []);
  const [activeTab, setActiveTab] = useState<string>('group');
  const [showQr, setShowQr] = useState(false);
  const [draft, setDraft] = useState('');
  // Which flap-tab of the section page is open: token chat picker or the
  // experimental IoT area.
  const [activeSection, setActiveSection] = useState<'chat' | 'iot'>('chat');
  const [showInfo, setShowInfo] = useState(false);
  const lastKnownReady = useDepinChatReadyState({
    identity,
    pubkeyRevealed,
    serverInfo,
  });

  const { keyboardHeight, messagesListRef } = useDepinChatKeyboard();

  // Back handling is owned by WalletTransactions (which also owns the tab
  // state): on a back action it calls goBack() first, so an open token chat
  // closes before the tab or the screen does.
  useImperativeHandle(
    ref,
    () => ({
      goBack: () => {
        if (selectedAsset == null) return false;
        setSelectedAsset(null);
        return true;
      },
    }),
    [selectedAsset],
  );

  const {
    groupMessages,
    privateConversations,
    error,
    lastPoll,
    stats,
    fetchStats,
    sendMessage,
    checkAssetValidity,
    setIsPolling,
    createPrivateConversation,
  } = useDePINChat({
    rpc,
    selectedAsset,
    identity,
    recipientList,
  });

  // Contacts drawer (mirrors the web wallet's left sidebar): Public Group,
  // then open private conversations, then the token holders you can start a
  // private chat with.
  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const openDrawer = useCallback(() => {
    setDrawerVisible(true);
    Animated.timing(drawerAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [drawerAnim]);
  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setDrawerVisible(false));
  }, [drawerAnim]);
  const selectConversation = useCallback(
    (tab: string) => {
      if (tab !== 'group' && !privateConversations.has(tab)) createPrivateConversation(tab);
      setActiveTab(tab);
      closeDrawer();
    },
    [privateConversations, createPrivateConversation, closeDrawer],
  );

  // Chat info modal: server DePIN characteristics (depingetmsginfo) plus live
  // pool stats (depinpoolstats) and the member list.
  const openInfo = useCallback(() => {
    setShowInfo(true);
    fetchStats();
    refreshServerInfo();
  }, [fetchStats, refreshServerInfo]);

  // When a token is selected: load recipients + verify validity + start polling.
  const selectAsset = useCallback(
    async (assetName: string) => {
      if (!rpc) return;
      setSelectedAsset(assetName);
      setActiveTab('group');
      setIsPolling(true);
      try {
        // Both calls use the full on-chain asset name ('&NAME'). If the server
        // is configured with a different token spelling, this one may fail —
        // that's non-fatal: pubkeys are then resolved lazily per address via
        // `getpubkey`, and the hook adapts the spelling on its polling path.
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
      const backend = getBackend();
      const utxos = await backend.getUtxos([identity.address]);
      const { signedHex } = await neurai.buildDepinPubkeyRevealTransaction({
        depinAddress: identity.address,
        depinWif: identity.wif,
        utxos,
        burnAddress: BURN_ADDRESS[network],
        amountSats: Math.round(REVEAL_AMOUNT_XNA * ONE_COIN),
      });
      await backend.broadcast(signedHex);
      setRevealPending(true);
      if (revealRetryTimerRef.current) clearTimeout(revealRetryTimerRef.current);
      revealRetryTimerRef.current = setTimeout(() => setRevealPending(false), REVEAL_RETRY_MS);
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
  }, [getBackend, identity, network, neurai, revealing, rpc]);

  const copyAddress = useCallback(() => {
    if (!identity) return;
    Clipboard.setString(identity.address);
    presentAlert({ message: loc.depin.address_copied });
  }, [identity]);

  // Not enough XNA at the chat address for the reveal burn: jump to the parent
  // wallet's Send screen with the chat address and the amount pre-filled, so
  // the user only has to confirm.
  const goFundDepinAddress = useCallback(() => {
    if (!identity) return;
    navigate('SendNeurai', { walletID, address: identity.address, amount: FUND_AMOUNT_XNA });
  }, [identity, navigate, walletID]);

  const messages = useMemo<IMessage[]>(() => {
    const src = activeTab === 'group' ? groupMessages : (privateConversations.get(activeTab)?.messages ?? []);
    return (
      src
        .map((m, i) => ({
          _id: `${m.messageHash ?? m.sender}-${m.timestamp}-${i}`,
          text: m.message,
          createdAt: new Date(m.timestamp * 1000),
          // Last 4 chars as the display name: every address on a network starts
          // with the same prefix, so first-letter avatars would all look alike.
          user: { _id: m.sender, name: m.sender.slice(-4) },
        }))
        // Oldest first: paired with GiftedChat's `inverted={false}` below this
        // renders top-to-bottom (first message at the top, newest at the bottom).
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    );
  }, [activeTab, groupMessages, privateConversations]);

  // With a non-inverted list, GiftedChat does NOT follow new messages — they
  // appear below the visible area while the view stays frozen. Whenever a
  // message arrives (sent or received) or the conversation tab changes, slide
  // to the end so the latest message is always in view. The small delay lets
  // the list commit the new row before measuring the scroll target.
  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount === 0) return;
    const t = setTimeout(() => messagesListRef.current?.scrollToEnd?.({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messageCount, activeTab, messagesListRef]);

  // We render our own input bar (below) instead of GiftedChat's built-in
  // InputToolbar, which proved unreliable to display in this embedded layout.
  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const payload = activeTab === 'group' ? text : `@${activeTab} ${text}`;
    sendMessage(payload).catch((e: any) => presentAlert({ message: e?.message ?? loc.depin.send_failed }));
    setDraft('');
  }, [draft, activeTab, sendMessage]);

  const stylesHook = {
    root: { backgroundColor: colors.background },
    text: { color: colors.foregroundColor },
    subtext: { color: colors.alternativeTextColor },
    card: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
    chip: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
    chipActive: { backgroundColor: colors.elevated, borderColor: colors.foregroundColor },
    chipText: { color: colors.foregroundColor },
    banner: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
    divider: { backgroundColor: colors.formBorder },
    // With the keyboard open the chat column already ends right above it, so
    // the input bar only needs a small padding instead of the nav-bar inset.
    inputBar: {
      backgroundColor: colors.elevated,
      borderTopColor: colors.formBorder,
      paddingBottom: keyboardHeight > 0 ? 8 : insets.bottom || 8,
    },
    inputField: { color: colors.foregroundColor, backgroundColor: colors.inputBackgroundColor },
    // RN reports the keyboard height without the system nav-bar inset when the
    // app draws edge-to-edge, so pad by both — otherwise the input bar ends up
    // mostly hidden behind the keyboard (only a few px visible).
    chatRoot: { paddingBottom: keyboardHeight > 0 ? keyboardHeight + (insets.bottom || 0) : 0 },
  };

  const gearButton = (
    <Pressable
      onPress={() => navigate('DepinRpcEdit', { network })}
      style={styles.gear}
      accessibilityLabel={loc.depin.config}
      testID="DepinChatConfig"
    >
      <Icon name="settings" type="material" size={22} color="#f97316" />
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
  // Access per token: the DePIN server serves exactly one token — green when
  // this asset is the one it serves (and the pool is enabled), red when not,
  // neutral while the server hasn't answered yet.
  const serverTokenNorm = serverInfo?.token ? serverInfo.token.replace(/^&/, '').toUpperCase() : null;
  const tokenHasAccess = (name: string): boolean | null =>
    serverInfo == null ? null : !!serverInfo.enabled && serverTokenNorm === name.replace(/^&/, '').toUpperCase();
  // Fully ready to operate: server pool enabled AND our pubkey is on-chain.
  // Until both checks have answered, fall back to the remembered state so the
  // badge doesn't flash red on every entry.
  const readyKnown = serverInfo != null && pubkeyRevealed != null;
  const isReady = readyKnown ? serverInfo.enabled === true && pubkeyRevealed === true : (lastKnownReady ?? false);
  // Chat section availability drives the DePIN Chat flap-tab color: green when
  // the server pool is up and serves one of the held tokens; red = inert tab.
  const chatActive =
    serverInfo == null ? (lastKnownReady ?? false) : serverInfo.enabled === true && assetNames.some(n => tokenHasAccess(n) === true);
  const revealBanner = (
    <DepinChatRevealBanner
      depinBalance={depinBalance}
      onFund={goFundDepinAddress}
      onReveal={handleReveal}
      pubkeyRevealed={pubkeyRevealed}
      revealPending={revealPending}
      revealing={revealing}
      stylesHook={stylesHook}
    />
  );

  // No token selected yet — the section page: the DePIN card (title, address,
  // derivation, Ready flap), a divider, then the flap-tabs: DePIN Chat (tokens)
  // and the experimental IoT area.
  if (!selectedAsset) {
    return (
      <ScrollView style={[styles.flex, stylesHook.root]} contentContainerStyle={styles.scrollContent}>
        <DepinChatAddressCard
          gearButton={gearButton}
          identity={identity}
          isReady={isReady}
          onCopy={copyAddress}
          onToggleQr={() => setShowQr(value => !value)}
          showQr={showQr}
          stylesHook={stylesHook}
        />

        <DepinChatTokenSections
          activeSection={activeSection}
          assetNames={assetNames}
          chatActive={chatActive}
          iconColor={colors.alternativeTextColor}
          loadingAssets={loadingAssets}
          onSelectAsset={selectAsset}
          onSelectSection={setActiveSection}
          revealBanner={revealBanner}
          stylesHook={stylesHook}
          tokenHasAccess={tokenHasAccess}
        />
      </ScrollView>
    );
  }

  const privateTabs = Array.from(privateConversations.values()).sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  // Holders you could start a private chat with: pubkey on-chain (required for
  // encryption) and no conversation open yet. Yourself is listed as notes.
  const holderContacts = recipientList.filter(r => r.pubkey && !privateConversations.has(r.address));
  const activeConvName =
    activeTab === 'group' ? loc.depin.tab_group : (privateConversations.get(activeTab)?.displayName ?? shortAddr(activeTab));

  return (
    // GiftedChat renders only the message list here (its built-in InputToolbar
    // and internal KeyboardProvider are both disabled); the input bar below is
    // ours, and `chatRoot` shrinks the whole column by the keyboard height.
    <View style={[styles.flex, stylesHook.root, stylesHook.chatRoot]}>
      <View style={styles.headerRow}>
        <Pressable onPress={openDrawer} style={styles.gear} accessibilityLabel={loc.depin.contacts_title} testID="DepinContactsOpen">
          <Icon name="menu" type="material" size={24} color={colors.foregroundColor} />
        </Pressable>
        <Pressable onPress={() => setSelectedAsset(null)} style={styles.backBtn}>
          <Text style={[styles.title, stylesHook.text]} numberOfLines={1}>
            {`# ${selectedAsset}`}
          </Text>
        </Pressable>
        <Pressable onPress={openInfo} style={styles.gear} accessibilityLabel={loc.depin.info_title} testID="DepinChatInfo">
          <Icon name="information-circle-outline" type="ionicons" size={22} color={colors.alternativeTextColor} />
        </Pressable>
        {gearButton}
      </View>

      <DepinChatInfoModal
        onClose={() => setShowInfo(false)}
        recipients={recipientList}
        selectedAsset={selectedAsset}
        serverInfo={serverInfo}
        stats={stats}
        stylesHook={stylesHook}
        visible={showInfo}
      />

      <Pressable onPress={openDrawer} style={styles.activeConvRow} testID="DepinActiveConversation">
        {activeTab === 'group' ? (
          <Icon name="groups" type="material" size={18} color={colors.alternativeTextColor} />
        ) : (
          <View style={styles.onlineDot} />
        )}
        <Text style={[styles.activeConvText, stylesHook.text]} numberOfLines={1}>
          {activeConvName}
        </Text>
        <Icon name="expand-more" type="material" size={18} color={colors.alternativeTextColor} />
      </Pressable>

      {revealBanner}
      {error ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" />
          <Text style={[styles.errorText, stylesHook.subtext]}>{`${error} — ${loc.depin.connection_retrying}`}</Text>
        </View>
      ) : !lastPoll ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" />
          <Text style={[styles.errorText, stylesHook.subtext]}>{loc.depin.checking_server}</Text>
        </View>
      ) : null}

      <View style={styles.flex}>
        <GiftedChat
          messages={messages}
          user={{ _id: identity.address }}
          isInverted={false}
          renderInputToolbar={() => null}
          // The type demands `children`, but GiftedChat itself supplies them
          // when it spreads these props onto its internal KeyboardProvider.
          keyboardProviderProps={{ enabled: false } as any}
          messagesContainerRef={messagesListRef}
          messagesContainerStyle={stylesHook.root}
          renderAvatar={(p: any) => (
            <View style={[styles.msgAvatar, stylesHook.chip]}>
              <Text style={[styles.msgAvatarText, stylesHook.chipText]}>{p?.currentMessage?.user?.name ?? '?'}</Text>
            </View>
          )}
        />
      </View>

      <View style={[styles.inputBar, stylesHook.inputBar]}>
        <TextInput
          style={[styles.inputField, stylesHook.inputField]}
          value={draft}
          onChangeText={setDraft}
          placeholder={activeTab === 'group' ? loc.depin.input_placeholder : loc.depin.input_placeholder_private}
          placeholderTextColor={colors.alternativeTextColor}
          multiline
          testID="DepinChatInput"
        />
        <Pressable
          onPress={handleSend}
          disabled={!draft.trim()}
          style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
          testID="DepinChatSend"
        >
          <Text style={styles.sendBtnGlyph}>➤</Text>
        </Pressable>
      </View>

      <DepinChatContactsDrawer
        activeTab={activeTab}
        closeDrawer={closeDrawer}
        drawerAnim={drawerAnim}
        holderContacts={holderContacts}
        identityAddress={identity.address}
        privateTabs={privateTabs}
        selectConversation={selectConversation}
        stylesHook={stylesHook}
        visible={drawerVisible}
      />
    </View>
  );
});

DePINChat.displayName = 'DePINChat';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 16, paddingBottom: 120 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { flex: 1, marginRight: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  gear: { padding: 8 },
  info: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  activeConvRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, columnGap: 6 },
  activeConvText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  msgAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  msgAvatarText: { fontSize: 10, fontWeight: '700' },
  errorText: { fontSize: 12, textAlign: 'center', paddingVertical: 6, flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', columnGap: 8, paddingHorizontal: 16 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
  },
  inputField: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f97316',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnGlyph: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
});

export default DePINChat;
