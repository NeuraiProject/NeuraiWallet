import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../blue_modules/hapticFeedback';
import type { NeuraiNetwork } from '../blue_modules/neurai/networkConfig';
import { useNetworkSelection } from '../hooks/useNetworkSelection';
import loc from '../loc';
import Icon from './Icon';
import { useTheme } from './themes';

/** Same green as the DePIN unread dot, so one green means one thing across the app. */
const UNSEEN_DOT_COLOR = '#22c55e';

const networkLabel = (network: NeuraiNetwork): string =>
  network === 'mainnet' ? loc.wallets.neurai_network_mainnet : loc.wallets.neurai_network_testnet;

/**
 * Header chip naming the network the home screen shows; a tap flips to the
 * other one. Same 32 height as the neighbouring "+" and "…" buttons, but on
 * the brand's light-orange chip tokens with a hairline border — `lightButton`
 * is white in the light theme, which left the label looking like plain text
 * rather than something to press.
 *
 * Renders nothing unless both networks have wallets — for the common
 * mainnet-only user the header stays exactly as it was.
 */
const NetworkSwitcher: React.FC = () => {
  const { colors } = useTheme();
  const { network, other, canSwitch, otherHasUnseen, setNetwork } = useNetworkSelection();

  const onPress = useCallback(() => {
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    setNetwork(other).catch(err => console.debug('[NetworkSwitcher] switch failed', err));
  }, [other, setNetwork]);

  if (!canSwitch) return null;

  const hint = otherHasUnseen
    ? loc.formatString(loc.wallets.network_switch_hint_unseen, { network: networkLabel(other) })
    : loc.formatString(loc.wallets.network_switch_hint, { network: networkLabel(other) });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={networkLabel(network)}
      accessibilityHint={String(hint)}
      testID="NetworkSwitcher"
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: colors.buttonBlueBackgroundColor, borderColor: colors.hdborderColor },
        pressed && styles.pillPressed,
      ]}
    >
      <Text style={[styles.label, { color: colors.foregroundColor }]}>{networkLabel(network)}</Text>
      <Icon name="swap-horiz" type="material" size={16} color={colors.buttonAlternativeTextColor} />
      {otherHasUnseen && (
        // Ringed in the header colour so it stays a dot against the pill edge.
        <View style={[styles.dot, { borderColor: colors.customHeader }]} testID="NetworkSwitcherUnseenDot" />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pill: {
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
  },
  pillPressed: { opacity: 0.7 },
  label: { fontSize: 13, fontWeight: '600' },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1.5,
    backgroundColor: UNSEEN_DOT_COLOR,
  },
});

export default NetworkSwitcher;
