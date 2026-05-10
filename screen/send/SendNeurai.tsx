/**
 * Simplified Send screen for Neurai wallets.
 *
 * The Bitcoin-era `SendDetails` + `Confirm` pair is built around bitcoinjs-lib
 * coin selection, PSBTs, payjoin, multisig and fee-rate controls expressed in
 * sat/vByte. None of that maps cleanly onto Neurai: the engine in
 * `@neuraiproject/neurai-jswallet` selects coins, builds and signs the
 * transaction, and asks the node for a fee via `estimatesmartfee` (target = 20
 * blocks; falls back to 0.05 XNA/kB if the node has no estimate). Per Neurai
 * `wallet/wallet.h:54` the node's own `DEFAULT_FALLBACK_FEE` is 1,025,000
 * sats/kB, and the lib stays above that.
 *
 * For now we expose the engine output as-is: the user types an address and an
 * amount in XNA, we build the transaction, show the engine-computed fee, and
 * broadcast on confirm. Custom fee tiers (slow/medium/fast) and full-balance
 * "send max" can be added later by wiring `forcedUTXOs`.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { BlueFormLabel, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20, BlueSpacing40 } from '../../components/BlueSpacing';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import type { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import type { NeuraiBuildTransactionResult, NeuraiTransactionTarget } from '../../class/wallets/abstract-neurai-wallet';

type RouteProps = RouteProp<DetailViewStackParamList, 'SendNeurai'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'SendNeurai'>;

const SendNeurai: React.FC = () => {
  const { colors } = useTheme();
  const { wallets } = useStorage();
  const { navigate } = useExtendedNavigation<NavigationProps>();
  const { params } = useRoute<RouteProps>();
  const found = wallets.find(w => w.getID() === params.walletID);
  const wallet = isNeuraiWallet(found) ? found : null;

  const [address, setAddress] = useState(params.address ?? '');
  const [amount, setAmount] = useState(params.amount ? String(params.amount) : '');
  const [draft, setDraft] = useState<NeuraiBuildTransactionResult | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const stylesHook = {
    label: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    root: { backgroundColor: colors.elevated },
    feeBox: { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
  };

  const buildDraft = useCallback(async () => {
    if (!wallet) return;
    Keyboard.dismiss();
    setDraft(null);
    if (!address.trim()) {
      presentAlert({ message: loc.send.details_address_field_is_not_valid });
      return;
    }
    if (!wallet.isAddressValid(address.trim())) {
      presentAlert({ message: loc.send.details_address_field_is_not_valid });
      return;
    }
    const xna = Number(amount);
    if (!Number.isFinite(xna) || xna <= 0) {
      presentAlert({ message: loc.send.details_amount_field_is_not_valid });
      return;
    }
    const targets: NeuraiTransactionTarget[] = [{ address: address.trim(), amount: xna }];
    setIsBuilding(true);
    try {
      const result = await wallet.buildSendTransaction(targets);
      if (!result.signedHex) throw new Error('Engine did not return a signed transaction');
      setDraft(result);
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBuilding(false);
    }
  }, [wallet, address, amount]);

  const broadcast = useCallback(async () => {
    if (!draft || !wallet) return;
    setIsBroadcasting(true);
    try {
      const txid = await wallet.broadcastTx(draft.signedHex);
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      presentAlert({ message: `${loc.send.broadcastSuccess}: ${txid}` });
      navigate('WalletTransactions', { walletID: wallet.getID(), walletType: wallet.type });
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBroadcasting(false);
    }
  }, [draft, wallet, navigate]);

  if (!wallet) {
    return (
      <View style={[styles.flex1, stylesHook.root, styles.center]}>
        <BlueText>{loc.errors.error}</BlueText>
      </View>
    );
  }

  return (
    <SafeAreaScrollView style={[styles.flex1, stylesHook.root]} testID="SendNeuraiScroll">
      <BlueSpacing20 />
      <BlueFormLabel>{loc.send.details_address}</BlueFormLabel>
      <View style={[styles.input, stylesHook.label]}>
        <TextInput
          testID="SendNeuraiAddress"
          value={address}
          placeholderTextColor="#81868e"
          placeholder={loc.send.details_address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isBuilding && !isBroadcasting}
          style={styles.textInput}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueFormLabel>{loc.send.details_amount_field_is_not_valid ? loc.send.create_amount : ''}</BlueFormLabel>
      <View style={[styles.input, stylesHook.label]}>
        <TextInput
          testID="SendNeuraiAmount"
          value={amount}
          placeholderTextColor="#81868e"
          placeholder="0.00000000"
          keyboardType="decimal-pad"
          onChangeText={setAmount}
          editable={!isBuilding && !isBroadcasting}
          style={styles.textInput}
          underlineColorAndroid="transparent"
        />
        <Text style={styles.unit}>XNA</Text>
      </View>

      {draft && (
        <View style={[styles.feeBox, stylesHook.feeBox]}>
          <Text style={styles.feeLabel}>{loc.send.create_fee}</Text>
          <Text style={styles.feeValue}>{draft.fee} XNA</Text>
        </View>
      )}

      <View style={styles.actions}>
        <BlueSpacing20 />
        {isBuilding || isBroadcasting ? (
          <ActivityIndicator />
        ) : draft ? (
          <Button testID="SendNeuraiBroadcast" title={loc.send.broadcastButton} onPress={broadcast} />
        ) : (
          <Button testID="SendNeuraiPreview" title={loc.send.details_next} onPress={buildDraft} />
        )}
        <BlueSpacing40 />
      </View>
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
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
  textInput: { flex: 1, marginHorizontal: 8, color: '#81868e' },
  unit: { paddingHorizontal: 12, fontWeight: '600', color: '#81868e' },
  feeBox: {
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 6,
  },
  feeLabel: { fontSize: 12, opacity: 0.6, marginBottom: 4 },
  feeValue: { fontSize: 16, fontWeight: '600' },
  actions: { marginHorizontal: 20 },
});

export default SendNeurai;
