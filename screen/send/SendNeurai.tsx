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
 * The user types an address and an amount in XNA, we build the transaction,
 * show the engine-computed fee and the amount to be sent, and broadcast on
 * confirm. Tapping the available-balance hint enters "send max" mode, which
 * spends the whole balance with the fee deducted (see `buildSendMaxTransaction`
 * and the hardware wallet's `sendMax` path). Custom fee tiers (slow/medium/fast)
 * can be added later.
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
import { NeuraiHardwareWallet, type NeuraiHwUnsignedSend } from '../../class/wallets/neurai-hardware-wallet';
import { useNeuraiHwDevice } from '../../blue_modules/neurai-hw/useNeuraiHwDevice';
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
  const hwWallet = wallet && wallet.type === NeuraiHardwareWallet.type ? (wallet as NeuraiHardwareWallet) : null;
  const hw = useNeuraiHwDevice();

  const [address, setAddress] = useState(params.address ?? '');
  const [amount, setAmount] = useState(params.amount ? String(params.amount) : '');
  const [draft, setDraft] = useState<NeuraiBuildTransactionResult | null>(null);
  const [hwDraft, setHwDraft] = useState<NeuraiHwUnsignedSend | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  // "Send max" defers the amount to build time (it is `balance − fee`, only
  // known once the fee is computed), so we track it as a mode rather than a
  // typed amount. Any manual edit to the amount field cancels it.
  const [isSendMax, setIsSendMax] = useState(false);

  const resetDrafts = useCallback(() => {
    setDraft(null);
    setHwDraft(null);
  }, []);

  const onChangeAddress = useCallback(
    (v: string) => {
      setAddress(v);
      resetDrafts();
    },
    [resetDrafts],
  );
  const onChangeAmount = useCallback(
    (v: string) => {
      setAmount(v);
      setIsSendMax(false);
      resetDrafts();
    },
    [resetDrafts],
  );

  // Available balance is stored in sats on the wallet; convert to whole XNA
  // for display next to the amount field so the user knows the cap without
  // backing out to the wallet view.
  const availableSats = wallet?.getBalance() ?? 0;
  const availableXna = availableSats / 1e8;

  // Use the callback path of ScanQRCode (it calls back + goBack()) instead of
  // the popTo path: SendNeurai lives inside the nested DetailViewScreensStack
  // while ScanQRCode is registered at the top-level DetailViewStack, so
  // popTo('SendNeurai') from the modal can't find it across navigators.
  const handleScanned = useCallback(
    (data: string) => {
      const parsed = parseScannedPayload(data);
      if (parsed.address) setAddress(parsed.address);
      if (parsed.amount) setAmount(parsed.amount);
      resetDrafts();
    },
    [resetDrafts],
  );

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
    textInput: { color: colors.foregroundColor },
    unit: { color: colors.alternativeTextColor },
    feeLabel: { color: colors.feeText },
    feeValue: { color: colors.feeValue },
  };

  const buildDraft = useCallback(async () => {
    if (!wallet) return;
    Keyboard.dismiss();
    resetDrafts();
    if (!address.trim()) {
      presentAlert({ message: loc.send.details_address_field_is_not_valid });
      return;
    }
    if (!wallet.isAddressValid(address.trim())) {
      presentAlert({ message: loc.send.details_address_field_is_not_valid });
      return;
    }
    const xna = Number(amount);
    if (!isSendMax && (!Number.isFinite(xna) || xna <= 0)) {
      presentAlert({ message: loc.send.details_amount_field_is_not_valid });
      return;
    }

    // Hardware wallet: build the unsigned transaction now (no device needed);
    // signing happens on the device in the next step.
    if (hwWallet) {
      setIsBuilding(true);
      try {
        const unsigned = isSendMax
          ? await hwWallet.buildUnsignedSend(address.trim(), 0, { sendMax: true })
          : await hwWallet.buildUnsignedSend(address.trim(), Math.round(xna * 1e8));
        setHwDraft(unsigned);
      } catch (err: any) {
        presentAlert({ message: err?.message ?? String(err) });
      } finally {
        setIsBuilding(false);
      }
      return;
    }

    setIsBuilding(true);
    try {
      let result: NeuraiBuildTransactionResult;
      if (isSendMax) {
        // Spend the whole balance: builder forces all UTXOs and deducts the fee.
        result = await wallet.buildSendMaxTransaction(address.trim());
      } else {
        // PQ wallets with address reuse on should send change back to the static
        // receive address; otherwise the engine picks a fresh index and surprises
        // the user who explicitly disabled rotation.
        let forcedChangeAddress: string | undefined;
        if (isPQAddressReuseEnabled && wallet.walletKind === 'pq') {
          const receiveAddr = await wallet.getStaticReceiveAddress();
          if (receiveAddr !== address.trim()) forcedChangeAddress = receiveAddr;
        }
        const targets: NeuraiTransactionTarget[] = [{ address: address.trim(), amount: xna }];
        result = await wallet.buildSendTransaction(targets, { forcedChangeAddress });
      }
      if (!result.signedHex) throw new Error('Engine did not return a signed transaction');
      setDraft(result);
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBuilding(false);
    }
  }, [wallet, hwWallet, address, amount, isSendMax, isPQAddressReuseEnabled, resetDrafts]);

  const broadcast = useCallback(async () => {
    if (!draft || !wallet) return;
    setIsBroadcasting(true);
    try {
      const txid = await wallet.broadcastTx(draft.signedHex);
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      presentAlert({ message: `${loc.send.broadcastSuccess}: ${txid}` });
      // Show the send immediately as a 0-conf pending entry and subtract it
      // from the balance; it is reconciled away once the tx confirms.
      wallet.addPendingTx(txid, -draft.netDebitSats);
      // Pull mempool + balance straight away so the wallet list reflects the
      // pending tx by the time we land on it. Failures here are non-fatal —
      // the WalletTransactions auto-poller will catch up within 10 s.
      Promise.all([wallet.fetchTransactions(), wallet.fetchBalance()]).catch(err => console.debug('post-broadcast refresh failed:', err));
      navigate('WalletTransactions', { walletID: wallet.getID(), walletType: wallet.type });
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBroadcasting(false);
    }
  }, [draft, wallet, navigate]);

  const hwSignAndBroadcast = useCallback(async () => {
    if (!hwWallet || !hwDraft) return;
    setIsBroadcasting(true);
    try {
      const device = await hw.connect();
      if (!device) throw new Error(hw.error || 'Could not connect to the hardware device');
      const { signedHex } = await hwWallet.signWithDevice(device, hwDraft);
      const txid = await hwWallet.broadcastTx(signedHex);
      await hw.disconnect().catch(() => {});
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      presentAlert({ message: `${loc.send.broadcastSuccess}: ${txid}` });
      // Show the send immediately as a 0-conf pending entry and subtract it
      // from the balance; it is reconciled away once the tx confirms.
      hwWallet.addPendingTx(txid, -(hwDraft.amountSats + hwDraft.feeSats));
      Promise.all([hwWallet.fetchTransactions(), hwWallet.fetchBalance()]).catch(err =>
        console.debug('post-broadcast refresh failed:', err),
      );
      navigate('WalletTransactions', { walletID: hwWallet.getID(), walletType: hwWallet.type });
    } catch (err: any) {
      await hw.disconnect().catch(() => {});
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBroadcasting(false);
    }
  }, [hwWallet, hwDraft, hw, navigate]);

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
          placeholderTextColor={colors.placeholderTextColor}
          placeholder={loc.send.details_address}
          onChangeText={onChangeAddress}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isBuilding && !isBroadcasting}
          style={[styles.textInput, stylesHook.textInput]}
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
          placeholderTextColor={colors.placeholderTextColor}
          placeholder="0.00000000"
          keyboardType="decimal-pad"
          onChangeText={onChangeAmount}
          editable={!isBuilding && !isBroadcasting}
          style={[styles.textInput, stylesHook.textInput]}
          underlineColorAndroid="transparent"
        />
        <Text style={[styles.unit, stylesHook.unit]}>XNA</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setIsSendMax(true);
          setAmount(availableXna.toFixed(8));
          resetDrafts();
        }}
        disabled={isBuilding || isBroadcasting || availableSats === 0}
        style={styles.balanceHintRow}
      >
        <Text style={[styles.balanceHint, { color: colors.alternativeTextColor }]}>
          {loc.formatString(loc.send.create_avail_max, { amount: availableXna.toFixed(8) })}
        </Text>
      </Pressable>

      {(draft || hwDraft) && (
        <View style={[styles.feeBox, stylesHook.feeBox]}>
          <Text style={[styles.feeLabel, stylesHook.feeLabel]}>{loc.send.create_amount}</Text>
          <Text style={[styles.feeValue, stylesHook.feeValue]}>
            {((draft ? draft.sentAmountSats : hwDraft!.amountSats) / 1e8).toFixed(8)} XNA
          </Text>
          <Text style={[styles.feeLabel, stylesHook.feeLabel, styles.feeLabelSpacer]}>{loc.send.create_fee}</Text>
          <Text style={[styles.feeValue, stylesHook.feeValue]}>{(draft ? draft.fee : hwDraft!.feeSats / 1e8).toFixed(8)} XNA</Text>
        </View>
      )}

      <View style={styles.actions}>
        <BlueSpacing20 />
        {isBuilding || isBroadcasting ? (
          <>
            <ActivityIndicator />
            {hwWallet && isBroadcasting ? (
              <Text style={[styles.feeLabel, styles.hwHint, stylesHook.feeLabel]}>
                {hw.status === 'connecting' ? 'Connect the device and confirm on it…' : 'Signing on device…'}
              </Text>
            ) : null}
          </>
        ) : hwWallet && hwDraft ? (
          <Button testID="SendNeuraiHwSign" title="Sign on device & broadcast" onPress={hwSignAndBroadcast} />
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
  textInput: { flex: 1, marginHorizontal: 8 },
  balanceHintRow: { marginHorizontal: 20, marginTop: -4, marginBottom: 8 },
  balanceHint: { fontSize: 12, textAlign: 'right' },
  scanButton: {
    paddingHorizontal: 12,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonPressed: { opacity: 0.5 },
  unit: { paddingHorizontal: 12, fontWeight: '600' },
  feeBox: {
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 6,
  },
  feeLabel: { fontSize: 12, opacity: 0.6, marginBottom: 4 },
  feeLabelSpacer: { marginTop: 12 },
  hwHint: { textAlign: 'center', marginTop: 8 },
  feeValue: { fontSize: 16, fontWeight: '600' },
  actions: { marginHorizontal: 20 },
});

export default SendNeurai;
