/**
 * The visual pieces every Neurai Connect approval screen is made of.
 *
 * They live here rather than inside each screen because the four approval
 * screens must look identical to each other. A login, a session proposal and a
 * `signMessage` are all "a site is asking you for something", and a user who
 * learns to read one of these screens has to be able to read the other three
 * without re-learning where the warning is, which colour means "stop", or
 * what a selectable option looks like.
 *
 * Layout rules shared by all of them:
 * - `connectStyles.content` sets the horizontal padding explicitly. The
 *   `padding` shorthand is not enough: SafeAreaScrollView adds its own
 *   `paddingLeft`/`paddingRight` (the device insets, often 0) unless those
 *   keys are present, and the specific key beats the shorthand, which is how
 *   the screens ended up flush with the edges.
 * - Facts live in cards (`ConnectCard`), choices are radio cards
 *   (`ConnectChoice`) with a visible indicator, and the two closing actions
 *   are always a filled Approve above an outlined Reject (`ConnectActions`).
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import Button from './Button';
import { useTheme } from './themes';

/** contentContainerStyle of every Connect screen (plain objects: they are used by other files). */
export const connectStyles: { content: ViewStyle; centered: ViewStyle } = {
  content: { paddingHorizontal: 20, paddingTop: 12 },
  centered: { paddingHorizontal: 24, flexGrow: 1, justifyContent: 'center' },
};

/** How loud a notice is. `danger` is reserved for "do not approve this". */
export type ConnectNoticeTone = 'info' | 'warn' | 'danger';

export const ConnectNotice: React.FC<{ tone: ConnectNoticeTone; text: string; testID?: string }> = ({ tone, text, testID }) => {
  const { colors } = useTheme();
  const palette = {
    info: {
      box: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
      text: { color: colors.foregroundColor },
    },
    warn: { box: { backgroundColor: colors.changeBackground, borderColor: colors.changeText }, text: { color: colors.changeText } },
    danger: { box: { backgroundColor: colors.redBG, borderColor: colors.redText }, text: { color: colors.redText } },
  }[tone];

  return (
    <View style={[styles.noticeBox, palette.box]} testID={testID}>
      <Text style={[styles.noticeText, palette.text]}>{text}</Text>
    </View>
  );
};

/**
 * Who is asking: the name in large type, the URL under it, and an optional
 * badge (the network, typically). Every approval screen starts with this.
 */
export const ConnectHeader: React.FC<{ title: string; subtitle?: string; badge?: string; testID?: string }> = ({
  title,
  subtitle,
  badge,
  testID,
}) => {
  const { colors } = useTheme();
  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.headerLine}>
        <Text style={[styles.headerTitle, { color: colors.foregroundColor }]} numberOfLines={2}>
          {title}
        </Text>
        {badge ? (
          <View style={[styles.badge, { borderColor: colors.mainColor }]}>
            <Text style={[styles.badgeText, { color: colors.mainColor }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? (
        <Text style={[styles.headerSubtitle, { color: colors.alternativeTextColor }]} selectable>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
};

/** A white card that groups related facts. */
export const ConnectCard: React.FC<{ children: React.ReactNode; testID?: string }> = ({ children, testID }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.elevated, borderColor: colors.formBorder }]} testID={testID}>
      {children}
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

/** A small uppercase heading over a group of cards or choices. */
export const ConnectSectionTitle: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foregroundColor }]}>{title}</Text>
      {hint ? <Text style={[styles.sectionHint, { color: colors.alternativeTextColor }]}>{hint}</Text> : null}
    </View>
  );
};

/**
 * A selectable option with a radio indicator. The whole card is the target;
 * the selected one gets the accent border and a tinted background so the
 * choice is visible at a glance, not only by comparing border colours.
 */
export const ConnectChoice: React.FC<{
  selected: boolean;
  disabled?: boolean;
  title: string;
  description?: string;
  detail?: string;
  onPress: () => void;
  testID?: string;
}> = ({ selected, disabled, title, description, detail, onPress, testID }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? colors.changeBackground : colors.elevated,
          borderColor: selected ? colors.mainColor : colors.formBorder,
        },
        disabled ? styles.choiceDisabled : null,
      ]}
      testID={testID}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.mainColor : colors.alternativeTextColor }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: colors.mainColor }]} /> : null}
      </View>
      <View style={styles.choiceBody}>
        <Text style={[styles.choiceTitle, { color: colors.foregroundColor }]}>{title}</Text>
        {description ? <Text style={[styles.choiceDescription, { color: colors.alternativeTextColor }]}>{description}</Text> : null}
        {detail ? (
          <Text style={[styles.choiceDetail, { color: colors.foregroundColor }]} selectable>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
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

/**
 * The closing pair of every approval screen: the filled primary action above
 * an outlined secondary one, so "approve" and "reject" never look the same.
 */
export const ConnectActions: React.FC<{
  primary?: { title: string; onPress: () => void; disabled?: boolean; testID?: string };
  secondary: { title: string; onPress: () => void; disabled?: boolean; testID?: string };
}> = ({ primary, secondary }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.actions}>
      {primary ? <Button title={primary.title} disabled={primary.disabled} onPress={primary.onPress} testID={primary.testID} /> : null}
      <View style={primary ? styles.actionsGap : null} />
      {/* No `style` prop: Button spreads its props last, so a style there replaces its own shape. */}
      <Button
        title={secondary.title}
        disabled={secondary.disabled}
        onPress={secondary.onPress}
        testID={secondary.testID}
        backgroundColor={colors.buttonGrayBackgroundColor}
        buttonTextColor={colors.foregroundColor}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  header: { marginBottom: 12 },
  headerLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 24, fontWeight: '700', flexShrink: 1, letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 14, marginTop: 3 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },

  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 12 },

  noticeBox: { borderWidth: 1, borderLeftWidth: 3, borderRadius: 10, padding: 12, marginBottom: 12 },
  noticeText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },

  row: { paddingVertical: 8 },
  rowLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  rowValue: { fontSize: 15, marginTop: 3, lineHeight: 21 },

  section: { marginTop: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  sectionHint: { fontSize: 13, marginTop: 2, lineHeight: 18 },

  choice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 10 },
  choiceDisabled: { opacity: 0.5 },
  choiceBody: { flex: 1 },
  choiceTitle: { fontSize: 15, fontWeight: '700' },
  choiceDescription: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  choiceDetail: { fontFamily: 'monospace', fontSize: 12, marginTop: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioDot: { width: 10, height: 10, borderRadius: 5 },

  monoBox: { borderWidth: 1, borderRadius: 12, maxHeight: 220, marginBottom: 12 },
  monoContent: { padding: 12 },
  mono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },

  actions: { marginTop: 8, marginBottom: 28 },
  actionsGap: { height: 12 },
});
