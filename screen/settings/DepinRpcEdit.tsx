/**
 * Configure the DePIN chat RPC endpoint for a single Neurai network.
 *
 * DePIN chat talks to a node with DePIN messaging enabled, which is typically
 * different from the wallet's balance/history backend and is run per-operator.
 * This screen lets the user point the chat at their own node (URL + optional
 * RPC credentials). The override is persisted via `setDepinRpcConfig` and
 * consumed by `getDepinRpcBackend`. Mirrors `NeuraiBackendEdit.tsx`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import {
  DEFAULT_DEPIN_RPC_URL,
  getDepinRpcOverride,
  loadDepinRpcOverrides,
  NeuraiNetwork,
  setDepinRpcConfig,
} from '../../blue_modules/neurai';
import { BlueFormLabel, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'DepinRpcEdit'>;

const DepinRpcEdit: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const route = useRoute<RouteProps>();
  const network: NeuraiNetwork = route.params?.network ?? 'mainnet';

  const defaultUrl = useMemo(() => DEFAULT_DEPIN_RPC_URL[network], [network]);
  const [url, setUrl] = useState<string>(defaultUrl);
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadDepinRpcOverrides();
      if (cancelled) return;
      const override = getDepinRpcOverride(network);
      setUrl(override?.url ?? defaultUrl);
      setUsername(override?.username ?? '');
      setPassword(override?.password ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [network, defaultUrl]);

  const stylesHook = {
    root: { backgroundColor: colors.elevated, flex: 1 },
    inputBox: { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
    input: { color: colors.foregroundColor },
    hint: { color: colors.foregroundColor },
  };

  const onSave = useCallback(async () => {
    Keyboard.dismiss();
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      presentAlert({ message: loc.depin.rpc_invalid_url });
      return;
    }
    setSaving(true);
    try {
      const user = username.trim();
      const pass = password.trim();
      // No override needed when it's just the public default with no credentials.
      const isDefault = trimmed === defaultUrl && user.length === 0 && pass.length === 0;
      await setDepinRpcConfig(network, isDefault ? null : { url: trimmed, username: user || undefined, password: pass || undefined });
      navigation.goBack();
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }, [url, username, password, defaultUrl, network, navigation]);

  const onReset = useCallback(async () => {
    setSaving(true);
    try {
      await setDepinRpcConfig(network, null);
      setUrl(defaultUrl);
      setUsername('');
      setPassword('');
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }, [network, defaultUrl]);

  const networkLabel = network === 'mainnet' ? loc.wallets.neurai_network_mainnet : loc.wallets.neurai_network_testnet;

  return (
    <ScrollView contentContainerStyle={styles.scroll} style={stylesHook.root} keyboardShouldPersistTaps="handled">
      <BlueSpacing20 />
      <BlueFormLabel>{networkLabel}</BlueFormLabel>

      <BlueFormLabel>{loc.depin.rpc_url_label}</BlueFormLabel>
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          testID="DepinRpcUrlInput"
          value={url}
          placeholder={defaultUrl}
          placeholderTextColor="#81868e"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          onChangeText={setUrl}
          style={[styles.input, stylesHook.input]}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueFormLabel>{loc.depin.rpc_username_label}</BlueFormLabel>
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          testID="DepinRpcUserInput"
          value={username}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          onChangeText={setUsername}
          style={[styles.input, stylesHook.input]}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueFormLabel>{loc.depin.rpc_password_label}</BlueFormLabel>
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          testID="DepinRpcPassInput"
          value={password}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          onChangeText={setPassword}
          style={[styles.input, stylesHook.input]}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueSpacing20 />
      <Button testID="DepinRpcSave" title={loc.depin.rpc_save} onPress={onSave} disabled={saving} />
      <BlueSpacing20 />
      <Button testID="DepinRpcReset" title={loc.depin.rpc_reset} onPress={onReset} disabled={saving} />

      <BlueSpacing20 />
      <BlueText style={[styles.hint, stylesHook.hint]}>{loc.formatString(loc.depin.rpc_hint, { defaultUrl })}</BlueText>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 20 },
  inputBox: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 12 },
  input: { paddingVertical: 4 },
  hint: { fontSize: 12, opacity: 0.6, marginTop: 8 },
});

export default DepinRpcEdit;
