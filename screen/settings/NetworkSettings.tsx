import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import {
  SettingsScrollView,
  SettingsSection,
  SettingsSectionHeader,
  SettingsListItem,
} from '../../components/platform';
import { useTheme } from '../../components/themes';
import {
  CHAIN_PARAMS,
  NeuraiNetwork,
  createDefaultBackend,
  getWssUrlOverride,
  loadOverrides,
} from '../../blue_modules/neurai';

type PingState = { status: 'idle' | 'pinging' | 'ok' | 'fail'; detail?: string };

const stripPort = (url: string): string => url.replace(/:\d+(?=\/|$)/, '');

const NetworkSettings: React.FC = () => {
  const navigation = useExtendedNavigation();
  const isNotificationsCapable = Platform.OS !== 'web';
  const { colors } = useTheme();

  const [mainnet, setMainnet] = useState<PingState>({ status: 'idle' });
  const [testnet, setTestnet] = useState<PingState>({ status: 'idle' });
  const [mainnetUrl, setMainnetUrl] = useState<string>(CHAIN_PARAMS.xna.defaultWssUrl);
  const [testnetUrl, setTestnetUrl] = useState<string>(CHAIN_PARAMS['xna-test'].defaultWssUrl);

  const refreshUrls = useCallback(async () => {
    await loadOverrides();
    setMainnetUrl(getWssUrlOverride('mainnet') ?? CHAIN_PARAMS.xna.defaultWssUrl);
    setTestnetUrl(getWssUrlOverride('testnet') ?? CHAIN_PARAMS['xna-test'].defaultWssUrl);
  }, []);

  const runPing = useCallback(async () => {
    setMainnet({ status: 'pinging' });
    setTestnet({ status: 'pinging' });
    await Promise.all([
      (async () => {
        try {
          const backend = createDefaultBackend('mainnet', 'legacy');
          const height = await backend.getTipHeight();
          setMainnet({ status: 'ok', detail: loc.formatString(loc.settings.network_backend_height, { height }) });
        } catch (err: any) {
          setMainnet({ status: 'fail', detail: err?.message ?? String(err) });
        }
      })(),
      (async () => {
        try {
          const backend = createDefaultBackend('testnet', 'legacy');
          const height = await backend.getTipHeight();
          setTestnet({ status: 'ok', detail: loc.formatString(loc.settings.network_backend_height, { height }) });
        } catch (err: any) {
          setTestnet({ status: 'fail', detail: err?.message ?? String(err) });
        }
      })(),
    ]);
  }, []);

  useEffect(() => {
    runPing();
  }, [runPing]);

  useFocusEffect(
    useCallback(() => {
      refreshUrls();
    }, [refreshUrls]),
  );

  const navigateToBlockExplorerSettings = () => {
    navigation.navigate('SettingsBlockExplorer');
  };

  const navigateToNotificationSettings = () => {
    navigation.navigate('NotificationSettings');
  };

  const navigateToBackendEdit = (network: NeuraiNetwork) => {
    navigation.navigate('NeuraiBackendEdit', { network });
  };

  const renderPingRow = (label: string, state: PingState) => {
    const okColor = colors.msSuccessCheck ?? '#2ecc71';
    const failColor = '#e74c3c';
    const dotColor = state.status === 'ok' ? okColor : state.status === 'fail' ? failColor : colors.alternativeTextColor;
    return (
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <View style={styles.rowText}>
          <Text style={[styles.label, { color: colors.foregroundColor }]}>{label}</Text>
          {state.status === 'pinging' ? (
            <ActivityIndicator size="small" style={styles.spinner} />
          ) : (
            <Text style={[styles.detail, { color: colors.alternativeTextColor }]} numberOfLines={2}>
              {state.detail ?? '—'}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SettingsScrollView>
      <SettingsSection horizontalInset={false}>
        <SettingsListItem
          title={loc.settings.block_explorer}
          iconName="blockExplorer"
          onPress={navigateToBlockExplorerSettings}
          testID="BlockExplorerSettings"
          chevron
          position="first"
        />

        {isNotificationsCapable && (
          <SettingsListItem
            title={loc.settings.notifications}
            iconName="notifications"
            onPress={navigateToNotificationSettings}
            testID="NotificationSettings"
            chevron
            position="last"
          />
        )}
      </SettingsSection>

      <SettingsSectionHeader title={loc.settings.network_backend} />
      <SettingsSection horizontalInset={false}>
        <SettingsListItem
          title={loc.wallets.neurai_network_mainnet}
          subtitle={stripPort(mainnetUrl)}
          iconName="electrum"
          onPress={() => navigateToBackendEdit('mainnet')}
          testID="NeuraiBackendMainnet"
          chevron
          position="first"
        />
        <SettingsListItem
          title={loc.wallets.neurai_network_testnet}
          subtitle={stripPort(testnetUrl)}
          iconName="electrum"
          onPress={() => navigateToBackendEdit('testnet')}
          testID="NeuraiBackendTestnet"
          chevron
          position="last"
        />
      </SettingsSection>

      <SettingsSection horizontalInset={false}>
        <View style={styles.statusCard}>
          <Text style={[styles.title, { color: colors.foregroundColor }]}>{loc.settings.network_backend_status_title}</Text>
          {renderPingRow(loc.wallets.neurai_network_mainnet, mainnet)}
          {renderPingRow(loc.wallets.neurai_network_testnet, testnet)}
          <Text onPress={runPing} style={[styles.retest, { color: colors.foregroundColor }]}>
            {loc.settings.network_backend_retest}
          </Text>
        </View>
      </SettingsSection>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  statusCard: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  rowText: { flex: 1 },
  label: { fontSize: 14, fontWeight: '500' },
  detail: { fontSize: 12, marginTop: 2 },
  spinner: { alignSelf: 'flex-start', marginTop: 2 },
  retest: { fontSize: 13, marginTop: 12, textAlign: 'center', textDecorationLine: 'underline' },
});

export default NetworkSettings;
