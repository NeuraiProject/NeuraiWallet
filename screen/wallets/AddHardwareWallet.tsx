import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BlueFormLabel } from '../../BlueComponents';
import Button from '../../components/Button';
import { BlueSpacing20, BlueSpacing40 } from '../../components/BlueSpacing';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';
import { deriveLegacyAddress } from '../../blue_modules/neurai-hw/xpubDerivation';
import { useNeuraiHwDevice } from '../../blue_modules/neurai-hw/useNeuraiHwDevice';
import loc from '../../loc';

const networkLabel = (chain: string): string => (chain.includes('test') ? 'Neurai Testnet' : 'Neurai');

/**
 * Add a NeuraiHW (ESP32) hardware wallet over USB.
 *
 * Flow: connect the device → approve USB permission → confirm on the device →
 * review the wallet details on this screen → Add (create the watch-only wallet)
 * or Cancel (discard and go back).
 */
const AddHardwareWallet: React.FC = () => {
  const { colors } = useTheme();
  const { status, error, connect, disconnect } = useNeuraiHwDevice();
  const { wallets, addWallet, saveToDisk } = useStorage();
  const navigation = useExtendedNavigation();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<NeuraiHardwareWallet | null>(null);

  const stylesHook = {
    root: { backgroundColor: colors.elevated },
    status: { color: colors.alternativeTextColor },
    fieldLabel: { color: colors.alternativeTextColor },
    fieldValue: { color: colors.foregroundColor },
    card: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
  };

  const isUnsupported = status === 'unsupported';

  const onConnect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const device = await connect();
      if (!device) throw new Error(error || loc.errors.error);

      const info = await device.getInfo();
      const isPQ = (info.key_type ?? 'legacy') === 'pq';
      const wallet = new NeuraiHardwareWallet();

      if (isPQ) {
        // PQ: a single address. `get_address` carries the pubkey + commitment.
        const addr = await device.getAddress(); // user confirms on the device
        wallet.setFromDeviceInfo(info, addr);
      } else {
        // Legacy: import the account xpub and manage addresses with HD derivation.
        const bip32 = await device.getBip32Pubkey(); // user confirms on the device
        const addr = {
          status: 'success',
          type: 'legacy' as const,
          address: info.address,
          pubkey: info.pubkey,
          path: info.path,
        };
        wallet.setFromDeviceInfo(info, addr, bip32);
        // Validate the whole derivation pipeline against the device: the address
        // derived from the xpub at 0/0 must equal the device's own address.
        const check = deriveLegacyAddress(wallet.xpub, wallet.network, 0, 0);
        if (check.address !== info.address) {
          throw new Error(loc.wallets.hardware_derivation_mismatch);
        }
      }
      await disconnect().catch(() => {});

      if (!wallet.address) throw new Error(loc.wallets.hardware_no_address);

      // Stage the wallet for review; it is only persisted when the user taps Add.
      setPending(wallet);
    } catch (e: unknown) {
      await disconnect().catch(() => {});
      presentAlert({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [busy, connect, disconnect, error]);

  const onAdd = useCallback(async () => {
    if (!pending) return;
    // Refuse to add the same device twice (match by pubkey, falling back to
    // address) so the user can't pile up duplicate wallets.
    const duplicate = wallets.some(
      w =>
        w.type === NeuraiHardwareWallet.type &&
        ((w as NeuraiHardwareWallet).pubkey === pending.pubkey || (w as NeuraiHardwareWallet).address === pending.address),
    );
    if (duplicate) {
      presentAlert({ message: loc.wallets.hardware_already_added });
      return;
    }
    addWallet(pending);
    await saveToDisk();
    triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    // Close the whole "Add wallet" modal and land on the wallet list.
    navigation.getParent()?.goBack();
  }, [pending, wallets, addWallet, saveToDisk, navigation]);

  const onCancel = useCallback(() => {
    setPending(null);
    navigation.goBack();
  }, [navigation]);

  const renderField = (label: string, value: string) => (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, stylesHook.fieldLabel]}>{label}</Text>
      <Text style={[styles.fieldValue, stylesHook.fieldValue]} selectable>
        {value}
      </Text>
    </View>
  );

  return (
    <SafeAreaScrollView style={stylesHook.root}>
      <BlueSpacing20 />

      {isUnsupported ? (
        <View style={styles.action}>
          <Text style={[styles.statusText, stylesHook.status]}>{loc.wallets.hardware_only_android}</Text>
        </View>
      ) : pending ? (
        <>
          <BlueFormLabel>{loc.wallets.hardware_review_title}</BlueFormLabel>
          <View style={[styles.card, stylesHook.card]}>
            {renderField(loc.wallets.hardware_field_network, networkLabel(pending.network))}
            {renderField(loc.wallets.hardware_field_type, pending.keyType === 'pq' ? 'Post-Quantum (ML-DSA-44)' : 'Legacy (ECDSA P2PKH)')}
            {renderField(loc.wallets.hardware_field_address, pending.address)}
            {renderField(loc.wallets.hardware_field_path, pending.hwPath)}
            {renderField(loc.wallets.hardware_field_fingerprint, pending.hwFingerprint)}
          </View>
          <View style={styles.action}>
            <Button testID="HardwareAddButton" title={loc.wallets.hardware_add} onPress={onAdd} />
            <BlueSpacing20 />
            <Button testID="HardwareCancelButton" title={loc._.cancel} onPress={onCancel} />
          </View>
          <BlueSpacing40 />
        </>
      ) : busy ? (
        <View style={styles.action}>
          <ActivityIndicator />
          <BlueSpacing20 />
          <Text style={[styles.statusText, stylesHook.status]}>{loc.wallets.hardware_connecting}</Text>
        </View>
      ) : (
        <>
          <BlueFormLabel>{loc.wallets.hardware_connect_instructions}</BlueFormLabel>
          <BlueSpacing40 />
          <View style={styles.action}>
            <Button testID="ConnectHardwareWalletButton" title={loc.wallets.hardware_connect_button} onPress={onConnect} />
          </View>
        </>
      )}
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  action: {
    marginHorizontal: 20,
  },
  statusText: {
    textAlign: 'center',
    fontSize: 13,
  },
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 20,
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default AddHardwareWallet;
