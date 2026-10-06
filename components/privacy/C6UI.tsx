/**
 * Building blocks of the privacy tab, in the DePIN section's visual language:
 * cards with a corner badge, rounded chips, folder tabs over a panel, the
 * orange primary button and outlined secondary buttons.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import Icon from '../Icon';
import { useTheme } from '../themes';

export const ACCENT = '#f97316';

export function usePrivacyTheme() {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      colors,
      text: { color: colors.foregroundColor },
      subtext: { color: colors.alternativeTextColor },
      card: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
      chip: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
      chipActive: { backgroundColor: colors.elevated, borderColor: ACCENT },
      panel: { backgroundColor: colors.elevated, borderColor: colors.formBorder },
      tabLine: { borderColor: colors.formBorder },
      input: { color: colors.foregroundColor, backgroundColor: colors.elevated, borderColor: colors.formBorder },
      error: { color: colors.failedColor },
      errorBox: { borderColor: colors.failedColor, backgroundColor: colors.redBG },
      placeholder: colors.placeholderTextColor,
    }),
    [colors],
  );
}

export function Card({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  const t = usePrivacyTheme();
  return (
    <View style={[styles.card, t.card]}>
      {badge}
      {children}
    </View>
  );
}

export type BadgeTone = 'ok' | 'busy' | 'off' | 'error';

export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const toneStyle =
    tone === 'ok' ? styles.badgeOk : tone === 'busy' ? styles.badgeBusy : tone === 'error' ? styles.badgeError : styles.badgeOff;
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function TestBadge({ label }: { label: string }) {
  return (
    <View style={styles.testBadge}>
      <Text style={styles.testBadgeText}>{label}</Text>
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  const t = usePrivacyTheme();
  return <Text style={[styles.label, t.subtext]}>{children}</Text>;
}

export function Hint({ children, lines }: { children: React.ReactNode; lines?: number }) {
  const t = usePrivacyTheme();
  return (
    <Text style={[styles.hint, t.subtext]} numberOfLines={lines}>
      {children}
    </Text>
  );
}

export function Chip(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  dot?: 'ok' | 'no';
  testID?: string;
}) {
  const t = usePrivacyTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || !props.onPress}
      style={[styles.chip, props.active ? t.chipActive : t.chip, props.active && styles.chipActive, props.disabled && styles.muted]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!props.active, disabled: !!props.disabled }}
      testID={props.testID}
    >
      {props.dot ? <View style={[styles.dot, props.dot === 'ok' ? styles.dotOk : styles.dotNo]} /> : null}
      <Text style={[styles.chipText, t.text]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; testID?: string }) {
  const disabled = props.disabled || props.busy;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      style={[styles.primary, disabled && styles.primaryDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!props.busy }}
      testID={props.testID}
    >
      {props.busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
      <Text style={styles.primaryText} numberOfLines={1}>
        {props.title}
      </Text>
    </Pressable>
  );
}

export function OutlineButton(props: { title: string; onPress: () => void; disabled?: boolean; danger?: boolean; testID?: string }) {
  const t = usePrivacyTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.outline, t.chip, props.disabled && styles.muted]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!props.disabled }}
      testID={props.testID}
    >
      <Text style={[styles.outlineText, props.danger ? t.error : t.text]} numberOfLines={1}>
        {props.title}
      </Text>
    </Pressable>
  );
}

export function IconButton(props: { name: string; onPress: () => void; label: string; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.iconButton, props.disabled && styles.muted]}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      testID={props.testID}
    >
      <Icon name={props.name as never} type="material" size={22} color={ACCENT} />
    </Pressable>
  );
}

export function FolderTabs<K extends string>(props: {
  tabs: Array<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const t = usePrivacyTheme();
  return (
    <View>
      <View style={styles.tabsRow}>
        <View style={[styles.tabFill, styles.tabFillLead, t.tabLine]} />
        {props.tabs.map(tab => {
          const selected = tab.key === props.value;
          return (
            <Pressable
              key={tab.key}
              onPress={() => props.onChange(tab.key)}
              disabled={props.disabled}
              style={
                selected ? [styles.tab, t.panel, styles.tabActive] : [styles.tab, styles.tabIdle, t.tabLine, props.disabled && styles.muted]
              }
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled: !!props.disabled }}
              testID={`PrivacyTab-${tab.key}`}
            >
              <Text style={[styles.tabText, selected ? t.text : t.subtext]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
        <View style={[styles.tabFill, styles.flex, t.tabLine]} />
      </View>
      <View style={[styles.panel, t.panel]}>{props.children}</View>
    </View>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  secure?: boolean;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  suffix?: string;
  testID?: string;
}) {
  const t = usePrivacyTheme();
  return (
    <View style={styles.field}>
      <Label>{props.label}</Label>
      <View style={[styles.inputRow, t.input]}>
        <TextInput
          style={[styles.input, t.text]}
          value={props.value}
          onChangeText={props.onChangeText}
          editable={props.editable !== false}
          secureTextEntry={props.secure}
          placeholder={props.placeholder}
          placeholderTextColor={t.placeholder}
          keyboardType={props.keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          testID={props.testID}
        />
        {props.suffix ? <Text style={[styles.suffix, t.subtext]}>{props.suffix}</Text> : null}
      </View>
    </View>
  );
}

/** One-line status of a running job: spinner, short phase, seconds and a cancel button. */
export function ProgressLine({
  text,
  seconds,
  onCancel,
  cancelLabel,
}: {
  text: string;
  seconds: number;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const t = usePrivacyTheme();
  return (
    <View style={styles.progress} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={ACCENT} />
      <Text style={[styles.progressText, t.text]} numberOfLines={1}>
        {text}
      </Text>
      <Text style={[styles.progressSeconds, t.subtext]}>{`${seconds}s`}</Text>
      <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel={cancelLabel}>
        <Icon name="close" type="material" size={20} color={t.colors.alternativeTextColor} />
      </Pressable>
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const t = usePrivacyTheme();
  return (
    <View style={[styles.errorBox, t.errorBox]} accessibilityRole="alert">
      <Text style={[styles.errorText, t.error]} numberOfLines={5}>
        {message}
      </Text>
    </View>
  );
}

/** Label / value line for summaries. */
export function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const t = usePrivacyTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, t.subtext]}>{label}</Text>
      <Text style={[mono ? styles.infoMono : styles.infoValue, t.text]} numberOfLines={1} ellipsizeMode="middle">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { opacity: 0.5 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
    zIndex: 1,
  },
  badgeOk: { backgroundColor: '#16a34a' },
  badgeBusy: { backgroundColor: '#f59e0b' },
  badgeOff: { backgroundColor: '#6b7280' },
  badgeError: { backgroundColor: '#dc2626' },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  testBadge: { backgroundColor: '#f59e0b', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  testBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  hint: { fontSize: 12, lineHeight: 17 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: '100%',
  },
  chipActive: { borderWidth: 1.5 },
  chipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOk: { backgroundColor: '#16a34a' },
  dotNo: { backgroundColor: '#dc2626' },
  primary: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    columnGap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  outline: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  outlineText: { fontSize: 14, fontWeight: '700' },
  iconButton: { padding: 6 },
  tabsRow: { flexDirection: 'row', alignItems: 'flex-end' },
  tabFill: { borderBottomWidth: 1 },
  tabFillLead: { width: 10 },
  tab: { paddingHorizontal: 12, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  tabActive: { paddingTop: 8, paddingBottom: 11, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 3, borderTopColor: ACCENT },
  tabIdle: { paddingTop: 6, paddingBottom: 8, borderBottomWidth: 1 },
  tabText: { fontSize: 14, fontWeight: '700' },
  panel: {
    padding: 14,
    rowGap: 12,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  field: { flexGrow: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 15, paddingVertical: 9 },
  suffix: { fontSize: 13, fontWeight: '600', marginLeft: 8 },
  progress: { flexDirection: 'row', alignItems: 'center', columnGap: 8, marginTop: 10 },
  progressText: { flex: 1, fontSize: 13, fontWeight: '600' },
  progressSeconds: { fontSize: 12, fontVariant: ['tabular-nums'] },
  errorBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  errorText: { fontSize: 13, lineHeight: 18 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', columnGap: 12, marginTop: 6 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  infoMono: { fontSize: 12, fontFamily: 'monospace', flexShrink: 1, textAlign: 'right' },
});
