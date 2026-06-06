/**
 * Simple Import flow for Neurai wallets.
 *
 * Asks for a 12-word mnemonic, the wallet kind (legacy ECDSA or post-quantum
 * ML-DSA-44) and the network (testnet by default, mainnet for the eventual
 * fork). Skips the BIP39 multi-format heuristics that
 * `class/wallet-import.ts` runs against Bitcoin paths — for Neurai there is
 * exactly one derivation path per kind, defined in `neurai-key`.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, TextInput, View } from 'react-native';

import { BlueFormLabel } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20, BlueSpacing40 } from '../../components/BlueSpacing';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import SegmentedControl from '../../components/SegmentedControl';
import { useTheme } from '../../components/themes';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { chainFor, NeuraiNetwork } from '../../blue_modules/neurai';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';

type WalletKind = 'legacy' | 'pq';

const KIND_OPTIONS: WalletKind[] = ['legacy', 'pq'];
const NETWORK_OPTIONS: NeuraiNetwork[] = ['testnet', 'mainnet'];

const ImportNeurai: React.FC = () => {
  const { colors } = useTheme();
  const { addWallet, saveToDisk } = useStorage();
  const navigation = useExtendedNavigation();

  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [kind, setKind] = useState<WalletKind>('legacy');
  const [network, setNetwork] = useState<NeuraiNetwork>('testnet');
  const [isImporting, setIsImporting] = useState(false);

  const stylesHook = {
    label: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    root: { backgroundColor: colors.elevated },
  };

  const importWallet = useCallback(async () => {
    Keyboard.dismiss();
    const mnemonicTrimmed = mnemonic.trim().replace(/\s+/g, ' ');
    if (!mnemonicTrimmed) {
      presentAlert({ message: loc.wallets.import_error });
      return;
    }
    setIsImporting(true);
    try {
      const wallet = kind === 'pq' ? new NeuraiPQWallet() : new NeuraiHDWallet();
      wallet.setNetwork(chainFor(network, kind));
      wallet.setSecret(mnemonicTrimmed);
      if (passphrase) wallet.setPassphrase(passphrase);
      // Derive at least one address eagerly so subsequent screens have data.
      try {
        await wallet.getReceiveAddressAsync();
      } catch {
        // engine could not initialise — surface a useful error
        throw new Error(loc.wallets.import_error);
      }
      addWallet(wallet);
      await saveToDisk();
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      presentAlert({
        message: loc.wallets.import_success,
        buttons: [{ text: loc._.ok, style: 'default', onPress: () => navigation.getParent()?.goBack() }],
        // Keep the dialog up until the user taps OK so the success is noticed.
        options: { cancelable: false },
      });
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsImporting(false);
    }
  }, [mnemonic, passphrase, kind, network, addWallet, saveToDisk, navigation]);

  // PQ wallets exist on testnet only for now: selecting PQ forces Testnet and
  // greys out the (mainnet-capable) network selector.
  const onKindChange = useCallback((idx: number) => {
    const next = KIND_OPTIONS[idx];
    setKind(next);
    if (next === 'pq') setNetwork('testnet');
  }, []);

  const kindValues = KIND_OPTIONS.map(k => (k === 'pq' ? 'PQ' : 'Legacy'));
  const networkValues = NETWORK_OPTIONS.map(n =>
    n === 'mainnet' ? loc.wallets.neurai_network_mainnet : loc.wallets.neurai_network_testnet,
  );

  return (
    <SafeAreaScrollView style={[styles.flex1, stylesHook.root]} testID="ImportNeuraiScroll" automaticallyAdjustKeyboardInsets>
      <BlueSpacing20 />
      <BlueFormLabel>{loc.wallets.import_explanation}</BlueFormLabel>
      <View style={[styles.input, styles.inputTall, stylesHook.label]}>
        <TextInput
          testID="ImportNeuraiMnemonic"
          value={mnemonic}
          placeholderTextColor="#81868e"
          placeholder={loc.wallets.import_title}
          onChangeText={setMnemonic}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isImporting}
          style={styles.textInputMultiline}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueFormLabel>{loc.wallets.import_passphrase_message}</BlueFormLabel>
      <View style={[styles.input, stylesHook.label]}>
        <TextInput
          testID="ImportNeuraiPassphrase"
          value={passphrase}
          placeholderTextColor="#81868e"
          placeholder={loc.wallets.import_passphrase_message}
          onChangeText={setPassphrase}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!isImporting}
          style={styles.textInput}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueFormLabel>{loc.wallets.add_wallet_type}</BlueFormLabel>
      <View style={styles.segment}>
        <SegmentedControl values={kindValues} selectedIndex={KIND_OPTIONS.indexOf(kind)} onChange={onKindChange} />
      </View>

      <BlueFormLabel>{loc.wallets.neurai_network_label}</BlueFormLabel>
      <View style={styles.segment}>
        <SegmentedControl
          values={networkValues}
          selectedIndex={NETWORK_OPTIONS.indexOf(network)}
          onChange={idx => setNetwork(NETWORK_OPTIONS[idx])}
          disabled={kind === 'pq'}
        />
      </View>

      <View style={styles.actions}>
        <BlueSpacing20 />
        {isImporting ? (
          <ActivityIndicator />
        ) : (
          <Button testID="ImportNeuraiSubmit" title={loc.wallets.import_do_import} onPress={importWallet} />
        )}
        <BlueSpacing40 />
      </View>
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  input: {
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    marginHorizontal: 20,
    alignItems: 'center',
    marginVertical: 12,
    borderRadius: 4,
  },
  inputTall: { minHeight: 110, height: 110, alignItems: 'flex-start', paddingTop: 12, paddingBottom: 12 },
  textInput: { flex: 1, marginHorizontal: 8, color: '#81868e' },
  textInputMultiline: { flex: 1, marginHorizontal: 8, color: '#81868e', textAlignVertical: 'top' },
  segment: { marginHorizontal: 20, marginVertical: 12 },
  actions: { marginHorizontal: 20 },
});

export default ImportNeurai;
