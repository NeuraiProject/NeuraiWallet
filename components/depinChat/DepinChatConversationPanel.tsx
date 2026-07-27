import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GiftedChat, type IMessage } from 'react-native-gifted-chat';

import loc from '../../loc';
import Icon from '../Icon';

interface DepinChatConversationPanelProps {
  activeConversationName: string;
  activeTab: string;
  draft: string;
  error: string | null;
  gearButton: ReactNode;
  identityAddress: string;
  lastPoll: Date | null;
  messages: IMessage[];
  messagesListRef: any;
  onBack: () => void;
  onChangeDraft: (draft: string) => void;
  onOpenDrawer: () => void;
  /** Unread across all conversations — shows a dot on the contacts button. */
  unreadCount: number;
  onOpenInfo: () => void;
  onSend: () => void;
  overlays: ReactNode;
  placeholderColor: string;
  revealBanner: ReactNode;
  selectedAsset: string;
  stylesHook: any;
}

const DepinChatConversationPanel = ({
  activeConversationName,
  activeTab,
  draft,
  error,
  gearButton,
  identityAddress,
  lastPoll,
  messages,
  messagesListRef,
  onBack,
  onChangeDraft,
  onOpenDrawer,
  unreadCount,
  onOpenInfo,
  onSend,
  overlays,
  placeholderColor,
  revealBanner,
  selectedAsset,
  stylesHook,
}: DepinChatConversationPanelProps) => (
  <View style={[styles.flex, stylesHook.root, stylesHook.chatRoot]}>
    <View style={styles.headerRow}>
      <Pressable onPress={onOpenDrawer} style={styles.gear} accessibilityLabel={loc.depin.contacts_title} testID="DepinContactsOpen">
        <Icon name="menu" type="material" size={24} color={stylesHook.text.color} />
        {unreadCount > 0 && <View style={styles.unreadDot} testID="DepinUnreadDot" />}
      </Pressable>
      <Pressable onPress={onBack} style={styles.backBtn}>
        <Text style={[styles.title, stylesHook.text]} numberOfLines={1}>
          {`# ${selectedAsset}`}
        </Text>
      </Pressable>
      <Pressable onPress={onOpenInfo} style={styles.gear} accessibilityLabel={loc.depin.info_title} testID="DepinChatInfo">
        <Icon name="information-circle-outline" type="ionicons" size={22} color={stylesHook.subtext.color} />
      </Pressable>
      {gearButton}
    </View>

    <Pressable onPress={onOpenDrawer} style={styles.activeConvRow} testID="DepinActiveConversation">
      {activeTab === 'group' ? (
        <Icon name="groups" type="material" size={18} color={stylesHook.subtext.color} />
      ) : (
        <View style={styles.onlineDot} />
      )}
      <Text style={[styles.activeConvText, stylesHook.text]} numberOfLines={1}>
        {activeConversationName}
      </Text>
      <Icon name="expand-more" type="material" size={18} color={stylesHook.subtext.color} />
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
        user={{ _id: identityAddress }}
        isInverted={false}
        renderInputToolbar={() => null}
        keyboardProviderProps={{ enabled: false } as any}
        messagesContainerRef={messagesListRef}
        messagesContainerStyle={stylesHook.root}
        renderAvatar={(props: any) => (
          <View style={[styles.msgAvatar, stylesHook.chip]}>
            <Text style={[styles.msgAvatarText, stylesHook.chipText]}>{props?.currentMessage?.user?.name ?? '?'}</Text>
          </View>
        )}
      />
    </View>

    <View style={[styles.inputBar, stylesHook.inputBar]}>
      <TextInput
        style={[styles.inputField, stylesHook.inputField]}
        value={draft}
        onChangeText={onChangeDraft}
        placeholder={activeTab === 'group' ? loc.depin.input_placeholder : loc.depin.input_placeholder_private}
        placeholderTextColor={placeholderColor}
        multiline
        testID="DepinChatInput"
      />
      <Pressable
        onPress={onSend}
        disabled={!draft.trim()}
        style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
        testID="DepinChatSend"
      >
        <Text style={styles.sendBtnGlyph}>➤</Text>
      </Pressable>
    </View>

    {overlays}
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { flex: 1, marginRight: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  gear: { padding: 8 },
  // Small green dot pinned to the contacts button's corner: unread traffic is
  // worth noticing but not worth a number at this size.
  unreadDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
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

export default DepinChatConversationPanel;
