import React, { useMemo } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PrivateConversation, RecipientInfo } from '../../hooks/useDePINChat';
import loc from '../../loc';
import Icon from '../Icon';
import { shortAddr } from './utils';

interface DepinChatContactsDrawerProps {
  activeTab: string;
  /** Unread arrivals in the public group. */
  groupUnread: number;
  closeDrawer: () => void;
  drawerAnim: Animated.Value;
  holderContacts: RecipientInfo[];
  identityAddress: string;
  privateTabs: PrivateConversation[];
  selectConversation: (address: string) => void;
  stylesHook: any;
  visible: boolean;
}

const DepinChatContactsDrawer = ({
  activeTab,
  groupUnread,
  closeDrawer,
  drawerAnim,
  holderContacts,
  identityAddress,
  privateTabs,
  selectConversation,
  stylesHook,
  visible,
}: DepinChatContactsDrawerProps) => {
  const drawerTranslateX = useMemo(() => drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [-DRAWER_WIDTH, 0] }), [drawerAnim]);

  if (!visible) return null;

  return (
    <View style={styles.drawerOverlay}>
      <Animated.View style={[styles.drawerBackdrop, { opacity: drawerAnim }]}>
        <Pressable style={styles.flex} onPress={closeDrawer} accessibilityLabel={loc.depin.info_close} />
      </Animated.View>
      <Animated.View style={[styles.drawer, stylesHook.card, { transform: [{ translateX: drawerTranslateX }] }]}>
        <View style={styles.drawerHeader}>
          <Text style={[styles.title, stylesHook.text]}>{loc.depin.contacts_title}</Text>
          <Pressable onPress={closeDrawer} style={styles.gear} testID="DepinContactsClose">
            <Icon name="close" type="material" size={22} color={stylesHook.subtext.color} />
          </Pressable>
        </View>
        <ScrollView>
          <Pressable
            onPress={() => selectConversation('group')}
            style={[styles.drawerItem, activeTab === 'group' && stylesHook.chipActive]}
            testID="DepinDrawerGroup"
          >
            <View style={[styles.drawerAvatar, stylesHook.chip]}>
              <Icon name="groups" type="material" size={20} color={stylesHook.text.color} />
            </View>
            <View style={styles.drawerItemInfo}>
              <Text style={[styles.drawerItemName, stylesHook.text]}>{loc.depin.tab_group}</Text>
              <Text style={[styles.drawerItemSub, stylesHook.subtext]}>{loc.depin.contacts_everyone}</Text>
            </View>
            {groupUnread > 0 && <View style={styles.unreadDot} />}
          </Pressable>

          {privateTabs.map(conversation => (
            <Pressable
              key={conversation.address}
              onPress={() => selectConversation(conversation.address)}
              style={[styles.drawerItem, activeTab === conversation.address && stylesHook.chipActive]}
            >
              <View style={[styles.drawerAvatar, stylesHook.chip]}>
                <Text style={[styles.msgAvatarText, stylesHook.chipText]}>{conversation.address.slice(-4)}</Text>
              </View>
              <View style={styles.drawerItemInfo}>
                <Text style={[styles.drawerItemName, stylesHook.text]}>{conversation.displayName}</Text>
                <Text style={[styles.drawerItemSub, stylesHook.subtext]}>{shortAddr(conversation.address)}</Text>
              </View>
              {conversation.unreadCount > 0 && <View style={styles.unreadDot} />}
            </Pressable>
          ))}

          {holderContacts.length > 0 && (
            <>
              <Text style={[styles.drawerSection, stylesHook.subtext]}>{loc.depin.contacts_title}</Text>
              {holderContacts.map(contact => (
                <Pressable key={contact.address} onPress={() => selectConversation(contact.address)} style={styles.drawerItem}>
                  <View style={[styles.drawerAvatar, stylesHook.chip]}>
                    {contact.address === identityAddress ? (
                      <Icon name="star" type="material" size={18} color="#f59e0b" />
                    ) : (
                      <Text style={[styles.msgAvatarText, stylesHook.chipText]}>{contact.address.slice(-4)}</Text>
                    )}
                  </View>
                  <View style={styles.drawerItemInfo}>
                    <Text style={[styles.drawerItemName, stylesHook.text]}>
                      {contact.address === identityAddress ? loc.depin.contacts_me : shortAddr(contact.address)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const DRAWER_WIDTH = 280;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gear: { padding: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  msgAvatarText: { fontSize: 10, fontWeight: '700' },
  drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  drawer: { width: DRAWER_WIDTH, height: '100%', borderRightWidth: 1, borderTopRightRadius: 14, borderBottomRightRadius: 14 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, columnGap: 12 },
  drawerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  drawerItemInfo: { flex: 1 },
  // Same green marker as the contacts button, so the two read as one signal.
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e' },
  drawerItemName: { fontSize: 14, fontWeight: '600' },
  drawerItemSub: { fontSize: 12, marginTop: 1 },
  drawerSection: { fontSize: 12, fontWeight: '700', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4, textTransform: 'uppercase' },
});

export default DepinChatContactsDrawer;
