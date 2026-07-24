import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import loc from '../../loc';
import Icon from '../Icon';
import { FUND_AMOUNT_XNA, REVEAL_AMOUNT_XNA } from './constants';

interface DepinChatRevealBannerProps {
  depinBalance: number | null;
  onFund: () => void;
  onReveal: () => void;
  pubkeyRevealed: boolean | null;
  revealPending: boolean;
  revealing: boolean;
  stylesHook: any;
}

const DepinChatRevealBanner = ({
  depinBalance,
  onFund,
  onReveal,
  pubkeyRevealed,
  revealPending,
  revealing,
  stylesHook,
}: DepinChatRevealBannerProps) => {
  if (pubkeyRevealed !== false) return null;

  const needsFunding = depinBalance !== null && depinBalance < REVEAL_AMOUNT_XNA;
  return (
    <View style={[styles.banner, stylesHook.banner]}>
      <View style={styles.bannerTitleRow}>
        <Icon name="fire" type="font-awesome" size={18} color="#ef4444" />
        <Text style={[styles.bannerTitle, stylesHook.text]}>{loc.depin.reveal_title}</Text>
      </View>
      <Text style={[styles.bannerDesc, stylesHook.subtext]}>
        {loc.formatString(needsFunding ? loc.depin.reveal_need_funds : loc.depin.reveal_desc, {
          amount: needsFunding ? FUND_AMOUNT_XNA : REVEAL_AMOUNT_XNA,
          ticker: 'XNA',
        })}
      </Text>
      {needsFunding ? (
        <Pressable onPress={onFund} style={[styles.revealBtn, stylesHook.chipActive]} testID="DepinFundAddress">
          <Text style={[styles.revealBtnText, stylesHook.text]}>
            {loc.formatString(loc.depin.reveal_send_button, { amount: FUND_AMOUNT_XNA, ticker: 'XNA' })}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onReveal}
          disabled={revealing || revealPending}
          style={[styles.revealBtn, stylesHook.chipActive, revealPending && styles.revealBtnDisabled]}
          testID="DepinRevealPubkey"
        >
          {revealing ? (
            <ActivityIndicator />
          ) : (
            <Text style={[styles.revealBtnText, stylesHook.text]}>
              {revealPending
                ? loc.depin.reveal_waiting
                : loc.formatString(loc.depin.reveal_button, { amount: REVEAL_AMOUNT_XNA, ticker: 'XNA' })}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: { margin: 16, padding: 14, borderRadius: 12, borderWidth: 1 },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'center', columnGap: 8, marginBottom: 4 },
  bannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  bannerDesc: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  revealBtn: { paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  revealBtnDisabled: { opacity: 0.45 },
  revealBtnText: { fontSize: 14, fontWeight: '700' },
});

export default DepinChatRevealBanner;
