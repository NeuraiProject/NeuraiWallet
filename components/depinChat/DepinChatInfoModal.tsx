import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PoolStats, RecipientInfo } from '../../hooks/useDePINChat';
import loc from '../../loc';
import { shortAddr } from './utils';
import type { DepinServerInfo } from './types';

interface DepinChatInfoModalProps {
  onClose: () => void;
  recipients: RecipientInfo[];
  selectedAsset: string;
  serverInfo: DepinServerInfo | null;
  stats: PoolStats | null;
  stylesHook: any;
  visible: boolean;
}

const DepinChatInfoModal = ({ onClose, recipients, selectedAsset, serverInfo, stats, stylesHook, visible }: DepinChatInfoModalProps) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={modalStyles.modalBackdrop} onPress={onClose}>
      <Pressable style={[modalStyles.infoCard, stylesHook.card]}>
        <Text style={[modalStyles.bannerTitle, stylesHook.text]} numberOfLines={1}>
          {`${loc.depin.info_title} — ${selectedAsset}`}
        </Text>
        {(
          [
            [loc.depin.info_ttl, serverInfo?.messageexpiryhours != null ? `${serverInfo.messageexpiryhours} h` : null],
            [loc.depin.info_max_pool, serverInfo?.maxpoolsizemb != null ? `${serverInfo.maxpoolsizemb} MB` : null],
            [loc.depin.info_max_msg_size, serverInfo?.maxmessagesize != null ? `${serverInfo.maxmessagesize} B` : null],
            [loc.depin.info_max_recipients, serverInfo?.maxrecipients ?? null],
            [loc.depin.info_cipher, serverInfo?.cipher ?? null],
            [loc.depin.info_total_messages, stats?.total_messages ?? null],
            [loc.depin.info_expiring, stats?.expiring_in_24h ?? null],
            [loc.depin.info_members, recipients.length],
          ] as Array<[string, string | number | null]>
        ).map(([label, value]) =>
          value == null ? null : (
            <View style={modalStyles.infoRow} key={label}>
              <Text style={[modalStyles.infoLabel, stylesHook.subtext]}>{label}</Text>
              <Text style={[modalStyles.infoValue, stylesHook.text]}>{String(value)}</Text>
            </View>
          ),
        )}
        {recipients.length > 0 && (
          <Text style={[modalStyles.infoMembers, stylesHook.subtext]} numberOfLines={6}>
            {recipients.map(recipient => shortAddr(recipient.address)).join('   ')}
          </Text>
        )}
        <Pressable onPress={onClose} style={[modalStyles.revealBtn, stylesHook.chipActive, modalStyles.infoClose]} testID="DepinInfoClose">
          <Text style={[modalStyles.revealBtnText, stylesHook.text]}>{loc.depin.info_close}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal>
);

export default DepinChatInfoModal;

const modalStyles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'center', padding: 24 },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 18 },
  bannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, columnGap: 12 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  infoMembers: { fontSize: 12, marginTop: 10, lineHeight: 18 },
  revealBtn: { paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  infoClose: { marginTop: 16 },
  revealBtnText: { fontSize: 14, fontWeight: '700' },
});
