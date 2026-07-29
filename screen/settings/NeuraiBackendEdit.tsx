/**
 * Edit the WSS backend URL for a single Neurai network.
 *
 * The hardcoded default in `networkConfig.ts` is what the app uses out of the
 * box; users who want to point at their own `neurai-wallet-services` instance
 * (or hit a regional mirror) can override it here. The override is persisted
 * via `setWssUrlOverride` and consumed by `createDefaultBackend`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { CHAIN_PARAMS, NeuraiNetwork, chainFor, getWssUrlOverride, loadOverrides, setWssUrlOverride } from '../../blue_modules/neurai';
import { BlueFormLabel, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'NeuraiBackendEdit'>;

const NeuraiBackendEdit: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const route = useRoute<RouteProps>();
  const network: NeuraiNetwork = route.params?.network ?? 'mainnet';

  const defaultUrl = useMemo(() => CHAIN_PARAMS[chainFor(network, 'legacy')].defaultWssUrl, [network]);
  const [url, setUrl] = useState<string>(defaultUrl);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadOverrides();
      if (cancelled) return;
      const override = getWssUrlOverride(network);
      setUrl(override ?? defaultUrl);
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
    if (!/^wss:\/\/.+/i.test(trimmed)) {
      presentAlert({ message: loc.settings.neurai_backend_edit_invalid });
      return;
    }
    setSaving(true);
    try {
      const override = trimmed === defaultUrl ? null : trimmed;
      await setWssUrlOverride(network, override);
      navigation.goBack();
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }, [url, defaultUrl, network, navigation]);

  const onReset = useCallback(async () => {
    setSaving(true);
    try {
      await setWssUrlOverride(network, null);
      setUrl(defaultUrl);
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }, [network, defaultUrl]);

  const networkLabel =
    network === 'mainnet' ? loc.wallets.neurai_network_mainnet : loc.wallets.neurai_network_testnet;

  return (
    <ScrollView contentContainerStyle={styles.scroll} style={stylesHook.root} keyboardShouldPersistTaps="handled">
      <BlueSpacing20 />
      <BlueFormLabel>{networkLabel}</BlueFormLabel>
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          testID="NeuraiBackendUrlInput"
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

      <BlueSpacing20 />
      <Button testID="NeuraiBackendSave" title={loc.settings.save} onPress={onSave} disabled={saving} />
      <BlueSpacing20 />
      <Button testID="NeuraiBackendReset" title={loc.settings.neurai_backend_edit_reset} onPress={onReset} disabled={saving} />

      <BlueSpacing20 />
      <BlueText style={[styles.hint, stylesHook.hint]}>
        {loc.formatString(loc.settings.neurai_backend_edit_hint, { defaultUrl })}
      </BlueText>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 20 },
  inputBox: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 12 },
  input: { paddingVertical: 4 },
  hint: { fontSize: 12, opacity: 0.6, marginTop: 8 },
});

export default NeuraiBackendEdit;
