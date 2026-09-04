/**
 * The handful of visual pieces every Neurai Connect approval screen is made
 * of: a labelled field, a coloured notice, a section heading and a monospace
 * block.
 *
 * They live here rather than inside each screen because the four approval
 * screens must look identical to each other. A login, a session proposal and a
 * `signMessage` are all "a site is asking you for something", and a user who
 * learns to read one of these screens has to be able to read the other three
 * without re-learning where the warning is or which colour means "stop".
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from './themes';

/** How loud a notice is. `danger` is reserved for "do not approve this". */
export type ConnectNoticeTone = 'info' | 'warn' | 'danger';

export const ConnectNotice: React.FC<{ tone: ConnectNoticeTone; text: string; testID?: string }> = ({ tone, text, testID }) => {
  const { colors } = useTheme();
  const palette = {
    info: { box: { backgroundColor: colors.inputBackgroundColor }, text: { color: colors.foregroundColor } },
    warn: { box: { backgroundColor: colors.changeBackground }, text: { color: colors.changeText } },
    danger: { box: { backgroundColor: colors.redBG }, text: { color: colors.redText } },
  }[tone];

  return (
    <View style={[styles.noticeBox, palette.box]} testID={testID}>
      <Text style={[styles.noticeText, palette.text]}>{text}</Text>
    </View>
  );
};

/** One `label: value` line. The value wraps instead of being cut: addresses matter in full. */
export const ConnectRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.alternativeTextColor }]}>{label}</Text>
      <Text style={[styles.rowValue, mono ? styles.mono : null, { color: colors.foregroundColor }]} selectable>
        {value}
      </Text>
    </View>
  );
};

export const ConnectSectionTitle: React.FC<{ title: string }> = ({ title }) => {
  const { colors } = useTheme();
  return <Text style={[styles.sectionTitle, { color: colors.foregroundColor }]}>{title}</Text>;
};

/**
 * A block of text shown exactly as it will be signed or as the site wrote it.
 * It scrolls inside a bounded height so a long CAIP-122 message or a long
 * `signMessage` cannot push the Approve button off the screen — the user must
 * be able to reach the buttons without having read to the end, and to read to
 * the end without losing the buttons.
 */
export const ConnectMonospaceBlock: React.FC<{ text: string; testID?: string }> = ({ text, testID }) => {
  const { colors } = useTheme();
  return (
    <ScrollView
      style={[styles.monoBox, { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder }]}
      contentContainerStyle={styles.monoContent}
      nestedScrollEnabled
      testID={testID}
    >
      <Text style={[styles.mono, { color: colors.foregroundColor }]} selectable>
        {text}
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  noticeBox: { borderRadius: 8, padding: 12, marginVertical: 8 },
  noticeText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  row: { marginVertical: 6 },
  rowLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  rowValue: { fontSize: 15, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 4 },
  monoBox: { borderWidth: 1, borderRadius: 8, maxHeight: 240, marginTop: 8 },
  monoContent: { padding: 12 },
  mono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
