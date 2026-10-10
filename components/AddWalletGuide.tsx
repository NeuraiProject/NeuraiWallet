import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { WalletKind } from '../blue_modules/neurai';
import loc from '../loc';
import Icon, { MaterialDesignIconName } from './Icon';
import { useTheme } from './themes';

interface AddWalletGuideProps {
  onCreate: () => void;
  onImport: () => void;
  onHardware: () => void;
}

const WALLET_TYPES: { kind: WalletKind; label: () => string }[] = [
  { kind: 'legacy', label: () => loc.wallets.add_guide_type_legacy },
  { kind: 'ecdsa', label: () => loc.wallets.add_guide_type_ecdsa },
  { kind: 'pq', label: () => loc.wallets.add_guide_type_pq },
];

/** Where each branch meets its card: the middle of the card's title row. */
const BRANCH_Y = 30;
const RAIL_WIDTH = 28;
const LINE = 2;
const STEP_SIZE = 24;

/**
 * Shown under the carousel's "add a wallet" card instead of a transaction list:
 * the three ways in, drawn as branches of one tree, each opening its own flow.
 */
const AddWalletGuide: React.FC<AddWalletGuideProps> = ({ onCreate, onImport, onHardware }) => {
  const { colors } = useTheme();

  const themed = StyleSheet.create({
    line: { backgroundColor: colors.lightBorder },
    card: { backgroundColor: colors.elevated },
    badge: { backgroundColor: colors.changeBackground },
    title: { color: colors.foregroundColor },
    text: { color: colors.alternativeTextColor },
    chip: { backgroundColor: colors.background, borderColor: colors.lightBorder },
    step: { backgroundColor: colors.changeBackground },
    stepNumber: { color: colors.changeText },
  });

  const createSteps = [loc.wallets.add_guide_step_type, loc.wallets.add_guide_step_network, loc.wallets.add_guide_step_backup];

  const branches: {
    key: string;
    icon: MaterialDesignIconName;
    title: string;
    text: string;
    onPress: () => void;
    extra?: React.ReactNode;
  }[] = [
    {
      key: 'create',
      icon: 'wallet-plus-outline',
      title: loc.wallets.add_guide_create_title,
      text: loc.wallets.add_guide_create_text,
      onPress: onCreate,
      extra: (
        <>
          {/* Stepper: numbered stops on one line, labels underneath. */}
          <View style={styles.steps}>
            <View style={[styles.stepsLine, themed.step]} />
            {createSteps.map((step, i) => (
              <View key={step} style={styles.stepItem}>
                <View style={[styles.stepNumber, themed.step]}>
                  <Text style={[styles.stepNumberText, themed.stepNumber]}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepLabel, themed.title]} numberOfLines={2}>
                  {step}
                </Text>
              </View>
            ))}
          </View>
          {/* One row, equal widths. Which types a network offers is shown
              where it is chosen, in the add screen itself. */}
          <View style={styles.chips}>
            {WALLET_TYPES.map(({ kind, label }) => (
              <View key={kind} style={[styles.chip, themed.chip]}>
                <Text style={[styles.chipText, themed.title]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {label()}
                </Text>
              </View>
            ))}
          </View>
        </>
      ),
    },
    {
      key: 'import',
      icon: 'backup-restore',
      title: loc.wallets.add_guide_import_title,
      text: loc.wallets.add_guide_import_text,
      onPress: onImport,
    },
    {
      key: 'hardware',
      icon: 'usb-port',
      title: loc.wallets.add_guide_hardware_title,
      text: loc.wallets.add_guide_hardware_text,
      onPress: onHardware,
    },
  ];

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.root} testID="AddWalletGuide">
      <View style={styles.rootRow}>
        <View style={[styles.rootNode, themed.badge]}>
          <Icon name="plus" type="material-community" size={16} color={colors.changeText} />
        </View>
        <Text style={[styles.intro, themed.text]}>{loc.wallets.add_guide_intro}</Text>
      </View>

      {branches.map((branch, i) => {
        const isLast = i === branches.length - 1;
        return (
          <View key={branch.key} style={styles.branchRow}>
            <View style={styles.rail}>
              {/* Trunk: runs on to the next branch, or ends at this one (└). */}
              <View style={[styles.trunk, themed.line, isLast ? styles.trunkEnd : styles.trunkThrough]} />
              <View style={[styles.twig, themed.line]} />
            </View>
            <Pressable
              onPress={branch.onPress}
              accessibilityRole="button"
              accessibilityLabel={`${branch.title}. ${branch.text}`}
              testID={`AddWalletGuide-${branch.key}`}
              style={({ pressed }) => [styles.card, themed.card, pressed && styles.cardPressed]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.badge, themed.badge]}>
                  <Icon name={branch.icon} type="material-community" size={20} color={colors.changeText} />
                </View>
                <Text style={[styles.cardTitle, themed.title]} numberOfLines={2}>
                  {branch.title}
                </Text>
                <Icon name="chevron-right" type="material-community" size={22} color={colors.alternativeTextColor} />
              </View>
              <Text style={[styles.cardText, themed.text]}>{branch.text}</Text>
              {branch.extra}
            </Pressable>
          </View>
        );
      })}

      <View style={styles.tip}>
        <Icon name="shield-check-outline" type="material-community" size={18} color={colors.alternativeTextColor} />
        <Text style={[styles.tipText, themed.text]}>{loc.wallets.add_guide_tip}</Text>
      </View>
    </Animated.View>
  );
};

export default AddWalletGuide;

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  rootRow: { flexDirection: 'row', alignItems: 'center', columnGap: 10, marginBottom: 2 },
  rootNode: { width: RAIL_WIDTH, height: RAIL_WIDTH, borderRadius: RAIL_WIDTH / 2, alignItems: 'center', justifyContent: 'center' },
  intro: { flex: 1, fontSize: 14 },
  branchRow: { flexDirection: 'row' },
  rail: { width: RAIL_WIDTH + 10 },
  trunk: { position: 'absolute', left: (RAIL_WIDTH - LINE) / 2, width: LINE, top: 0 },
  trunkThrough: { bottom: 0 },
  trunkEnd: { height: BRANCH_Y + LINE / 2 },
  twig: { position: 'absolute', left: (RAIL_WIDTH - LINE) / 2, right: 0, top: BRANCH_Y - LINE / 2, height: LINE },
  card: { flex: 1, borderRadius: 16, padding: 14, marginTop: 10 },
  cardPressed: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', columnGap: 10 },
  badge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  cardText: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  steps: { flexDirection: 'row', marginTop: 14 },
  // From the first stop's centre to the last one's: each column is a third wide.
  stepsLine: { position: 'absolute', top: STEP_SIZE / 2 - 1, left: '16.67%', right: '16.67%', height: 2 },
  stepItem: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  stepNumber: { width: STEP_SIZE, height: STEP_SIZE, borderRadius: STEP_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 12, fontWeight: '700' },
  stepLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  chips: { flexDirection: 'row', columnGap: 6, marginTop: 14 },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '600' },
  tip: { flexDirection: 'row', alignItems: 'flex-start', columnGap: 8, marginTop: 18, paddingHorizontal: 4 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
