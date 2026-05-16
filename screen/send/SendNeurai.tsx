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
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MaterialIcons from '@react-native-vector-icons/material-icons';

import { BlueFormLabel, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20, BlueSpacing40 } from '../../components/BlueSpacing';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import type { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import type { NeuraiBuildTransactionResult, NeuraiTransactionTarget } from '../../class/wallets/abstract-neurai-wallet';

type RouteProps = RouteProp<DetailViewStackParamList, 'SendNeurai'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'SendNeurai'>;

/**
 * Parse a payment payload coming from a scanned QR. Accepts either a bare
 * Neurai address or a `xna:address?amount=N&label=...` URI. Anything that
 * doesn't look like a URI is returned as the address as-is.
 */
function parseScannedPayload(input: string): { address: string; amount?: string } {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith('xna:')) {
    return { address: trimmed };
  }
  const withoutScheme = trimmed.slice(4);
  const [addressPart, queryPart] = withoutScheme.split('?', 2);
  const result: { address: string; amount?: string } = { address: addressPart };
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v] = pair.split('=', 2);
      if (k === 'amount' && v) result.amount = decodeURIComponent(v);
    }
  }
  return result;
}

const SendNeurai: React.FC = () => {
  const { colors } = useTheme();
  const { wallets } = useStorage();
  const { isPQAddressReuseEnabled } = useSettings();
  const { navigate } = useExtendedNavigation<NavigationProps>();
  const { params } = useRoute<RouteProps>();
  const found = wallets.find(w => w.getID() === params.walletID);
  const wallet = isNeuraiWallet(found) ? found : null;

  const [address, setAddress] = useState(params.address ?? '');
  const [amount, setAmount] = useState(params.amount ? String(params.amount) : '');
  const [draft, setDraft] = useState<NeuraiBuildTransactionResult | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Available balance is stored in sats on the wallet; convert to whole XNA
  // for display next to the amount field so the user knows the cap without
  // backing out to the wallet view.
  const availableSats = wallet?.getBalance() ?? 0;
  const availableXna = availableSats / 1e8;

  // Use the callback path of ScanQRCode (it calls back + goBack()) instead of
  // the popTo path: SendNeurai lives inside the nested DetailViewScreensStack
  // while ScanQRCode is registered at the top-level DetailViewStack, so
  // popTo('SendNeurai') from the modal can't find it across navigators.
  const handleScanned = useCallback((data: string) => {
    const parsed = parseScannedPayload(data);
    if (parsed.address) setAddress(parsed.address);
    if (parsed.amount) setAmount(parsed.amount);
    setDraft(null);
  }, []);

  const openScanner = useCallback(() => {
    navigate('ScanQRCode', { onBarScanned: handleScanned, showFileImportButton: false });
  }, [navigate, handleScanned]);

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
      // PQ wallets with address reuse on should send change back to the static
      // receive address; otherwise the engine picks a fresh index and surprises
      // the user who explicitly disabled rotation.
      let forcedChangeAddress: string | undefined;
      if (isPQAddressReuseEnabled && wallet.walletKind === 'pq') {
        const receiveAddr = await wallet.getStaticReceiveAddress();
        if (receiveAddr !== address.trim()) forcedChangeAddress = receiveAddr;
      }
      const result = await wallet.buildSendTransaction(targets, { forcedChangeAddress });
      if (!result.signedHex) throw new Error('Engine did not return a signed transaction');
      setDraft(result);
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBuilding(false);
    }
  }, [wallet, address, amount, isPQAddressReuseEnabled]);

  const broadcast = useCallback(async () => {
    if (!draft || !wallet) return;
    setIsBroadcasting(true);
    try {
      const txid = await wallet.broadcastTx(draft.signedHex);
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      presentAlert({ message: `${loc.send.broadcastSuccess}: ${txid}` });
      // Pull mempool + balance straight away so the wallet list reflects the
      // pending tx by the time we land on it. Failures here are non-fatal —
      // the WalletTransactions auto-poller will catch up within 10 s.
      Promise.all([wallet.fetchTransactions(), wallet.fetchBalance()]).catch(err =>
        console.debug('post-broadcast refresh failed:', err),
      );
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loc.send.details_scan}
          testID="SendNeuraiScan"
          onPress={openScanner}
          disabled={isBuilding || isBroadcasting}
          style={({ pressed }) => [styles.scanButton, pressed && styles.scanButtonPressed]}
        >
          <MaterialIcons name="qr-code-scanner" size={22} color={colors.foregroundColor} />
        </Pressable>
      </View>

      <BlueFormLabel>{loc.send.create_amount}</BlueFormLabel>
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
      <Pressable
        accessibilityRole="button"
        onPress={() => setAmount(availableXna.toString())}
        disabled={isBuilding || isBroadcasting || availableSats === 0}
        style={styles.balanceHintRow}
      >
        <Text style={[styles.balanceHint, { color: colors.alternativeTextColor }]}>
          {loc.formatString(loc.send.create_avail_max, { amount: availableXna.toFixed(8) })}
        </Text>
      </Pressable>

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
  balanceHintRow: { marginHorizontal: 20, marginTop: -4, marginBottom: 8 },
  balanceHint: { fontSize: 12, textAlign: 'right' },
  scanButton: {
    paddingHorizontal: 12,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonPressed: { opacity: 0.5 },
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
