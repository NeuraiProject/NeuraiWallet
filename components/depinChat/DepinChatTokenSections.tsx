import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import loc from '../../loc';
import Icon from '../Icon';

interface DepinChatTokenSectionsProps {
  activeSection: 'chat' | 'iot';
  assetNames: string[];
  chatActive: boolean;
  iconColor: string;
  loadingAssets: boolean;
  onSelectAsset: (assetName: string) => void;
  onSelectSection: (section: 'chat' | 'iot') => void;
  revealBanner: ReactNode;
  stylesHook: any;
  tokenHasAccess: (assetName: string) => boolean | null;
}

const DepinChatTokenSections = ({
  activeSection,
  assetNames,
  chatActive,
  iconColor,
  loadingAssets,
  onSelectAsset,
  onSelectSection,
  revealBanner,
  stylesHook,
  tokenHasAccess,
}: DepinChatTokenSectionsProps) => (
  <>
    <View style={[styles.divider, stylesHook.divider]} />

    <View style={styles.sectionTabs}>
      <Pressable
        onPress={() => {
          if (chatActive) onSelectSection('chat');
        }}
        style={[
          styles.sectionTab,
          activeSection === 'chat' ? stylesHook.chipActive : stylesHook.chip,
          chatActive ? styles.sectionTabOk : styles.sectionTabNo,
        ]}
        testID="DepinSectionChat"
      >
        <View style={[styles.chipDot, chatActive ? styles.chipDotOk : styles.chipDotNo]} />
        <Text style={[styles.sectionTabText, stylesHook.chipText]}>{loc.depin.tab_chat}</Text>
      </Pressable>
      <Pressable
        onPress={() => onSelectSection('iot')}
        style={[styles.sectionTab, activeSection === 'iot' ? stylesHook.chipActive : stylesHook.chip]}
        testID="DepinSectionIot"
      >
        <Text style={[styles.sectionTabText, stylesHook.chipText]}>{loc.depin.tab_iot}</Text>
        <View style={styles.testBadge}>
          <Text style={styles.testBadgeText}>{loc.depin.iot_test_badge}</Text>
        </View>
      </Pressable>
    </View>

    {activeSection === 'chat' ? (
      <>
        <Text style={[styles.sectionLabel, stylesHook.subtext]}>{loc.depin.tokens_label}</Text>
        {loadingAssets && assetNames.length === 0 ? (
          <ActivityIndicator style={styles.loader} />
        ) : assetNames.length === 0 ? (
          <Text style={[styles.info, stylesHook.subtext]}>{loc.depin.no_token}</Text>
        ) : (
          <View style={styles.chipsWrap}>
            {assetNames.map(assetName => {
              const access = tokenHasAccess(assetName);
              return (
                <Pressable
                  key={assetName}
                  onPress={() => onSelectAsset(assetName)}
                  style={[styles.chip, stylesHook.chip, access === true && styles.chipAccess, access === false && styles.chipNoAccess]}
                  testID={`DepinAsset-${assetName}`}
                >
                  {access != null && <View style={[styles.chipDot, access ? styles.chipDotOk : styles.chipDotNo]} />}
                  <Text style={[styles.chipText, stylesHook.chipText]}>{assetName}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {revealBanner}
      </>
    ) : (
      <View style={[styles.banner, stylesHook.banner]}>
        <View style={styles.bannerTitleRow}>
          <Icon name="memory" type="material" size={18} color={iconColor} />
          <Text style={[styles.bannerTitle, stylesHook.text]}>{loc.depin.tab_iot}</Text>
        </View>
        <Text style={[styles.bannerDesc, stylesHook.subtext]}>{loc.depin.iot_placeholder}</Text>
      </View>
    )}
  </>
);

const styles = StyleSheet.create({
  info: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  loader: { marginVertical: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 20 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipAccess: { borderColor: '#16a34a', borderWidth: 1.5, backgroundColor: 'rgba(22, 163, 74, 0.10)' },
  chipNoAccess: { borderColor: '#dc2626', borderWidth: 1.5, backgroundColor: 'rgba(220, 38, 38, 0.08)' },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipDotOk: { backgroundColor: '#16a34a' },
  chipDotNo: { backgroundColor: '#dc2626' },
  chipText: { fontSize: 14, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 18 },
  sectionTabs: { flexDirection: 'row', columnGap: 8, marginTop: 14 },
  sectionTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 6,
    paddingVertical: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    borderWidth: 1,
  },
  sectionTabOk: { borderColor: '#16a34a' },
  sectionTabNo: { borderColor: '#dc2626', opacity: 0.7 },
  sectionTabText: { fontSize: 14, fontWeight: '700' },
  testBadge: { backgroundColor: '#f59e0b', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  testBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  banner: { margin: 16, padding: 14, borderRadius: 12, borderWidth: 1 },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'center', columnGap: 8, marginBottom: 4 },
  bannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  bannerDesc: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
});

export default DepinChatTokenSections;
