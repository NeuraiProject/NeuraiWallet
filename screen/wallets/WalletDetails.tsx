import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { writeFileAndExport } from '../../blue_modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { BlueCard, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import ListItem from '../../components/ListItem';
import { SecondButton } from '../../components/SecondButton';
import { useTheme } from '../../components/themes';
import prompt from '../../helpers/prompt';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import { XnaUnit } from '../../models/xnaUnits';
import { useStorage } from '../../hooks/context/useStorage';
import { useFocusEffect, useRoute, RouteProp, usePreventRemove, useLocale } from '@react-navigation/native';
import { Transaction, TWallet } from '../../class/wallets/types';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import HeaderMenuButton from '../../components/HeaderMenuButton';
import { Action } from '../../components/types';
import { CommonToolTipActions } from '../../typings/CommonToolTipActions';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { BlueLoading } from '../../components/BlueLoading';

type RouteProps = RouteProp<DetailViewStackParamList, 'WalletDetails'>;
const WalletDetails: React.FC = () => {
  const { saveToDisk, wallets, txMetadata, handleWalletDeletion } = useStorage();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const { walletID } = useRoute<RouteProps>().params;
  const { direction } = useLocale();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [backdoorPressed, setBackdoorPressed] = useState<number>(0);
  const walletRef = useRef<TWallet | undefined>(wallets.find(w => w.getID() === walletID));
  const wallet = walletRef.current as TWallet;
  // BIP47 (Bitcoin-only) and hardware-wallet flags don't apply to Neurai
  // wallets; the screens that consumed these states are gone.

  const [hideTransactionsInWalletsList, setHideTransactionsInWalletsList] = useState<boolean>(
    wallet.getHideTransactionsInWalletsList ? !wallet.getHideTransactionsInWalletsList() : true,
  );
  const { setOptions, navigate, navigateToWalletsList } = useExtendedNavigation();
  const { colors } = useTheme();
  const [walletName, setWalletName] = useState<string>(wallet.getLabel());

  const [masterFingerprint, setMasterFingerprint] = useState<string | undefined>();
  const walletTransactionsLength = useMemo<number>(() => wallet.getTransactions().length, [wallet]);
  const derivationPath = useMemo<string | null>(() => {
    try {
      // @ts-expect-error: Need to fix later
      if (wallet.getDerivationPath) {
        // @ts-expect-error: Need to fix later
        const path = wallet.getDerivationPath();
        return path.length > 0 ? path : null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }, [wallet]);
  const [isMasterFingerPrintVisible, setIsMasterFingerPrintVisible] = useState<boolean>(false);

  const navigateToOverviewAndDeleteWallet = useCallback(async () => {
    setIsLoading(true);
    const deletionSucceeded = await handleWalletDeletion(wallet.getID());
    if (deletionSucceeded) {
      navigateToWalletsList();
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presentWalletHasBalanceAlert = useCallback(async () => {
    triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
    try {
      const balance = formatBalanceWithoutSuffix(wallet.getBalance(), XnaUnit.SATS, true);
      const walletBalanceConfirmation = await prompt(
        loc.wallets.details_delete_wallet,
        loc.formatString(loc.wallets.details_del_wb_q, { balance }),
        true,
        'numeric',
        true,
        loc.wallets.details_delete,
      );
      // Remove any non-numeric characters before comparison
      const cleanedConfirmation = (walletBalanceConfirmation || '').replace(/[^0-9]/g, '');

      if (Number(cleanedConfirmation) === wallet.getBalance()) {
        navigateToOverviewAndDeleteWallet();
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      } else {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        setIsLoading(false);
        presentAlert({ message: loc.wallets.details_del_wb_err });
      }
    } catch (_) {}
  }, [navigateToOverviewAndDeleteWallet, wallet]);

  const handleDeleteButtonTapped = useCallback(() => {
    triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
    presentAlert({
      title: loc.wallets.details_delete_wallet,
      message: loc.wallets.details_are_you_sure,
      buttons: [
        {
          text: loc.wallets.details_yes_delete,
          onPress: async () => {
            const isBiometricsEnabled = await isBiometricUseCapableAndEnabled();
            if (isBiometricsEnabled) {
              if (!(await unlockWithBiometrics())) {
                setIsLoading(false);
                return false;
              }
            }
            if (wallet.getBalance && wallet.getBalance() > 0 && wallet.allowSend && wallet.allowSend()) {
              presentWalletHasBalanceAlert();
            } else {
              navigateToOverviewAndDeleteWallet();
            }
          },
          style: 'destructive',
        },
        {
          text: loc._.cancel,
          onPress: () => {
            setIsLoading(false);
            return false;
          },
          style: 'cancel',
        },
      ],
      options: { cancelable: false },
    });
  }, [isBiometricUseCapableAndEnabled, navigateToOverviewAndDeleteWallet, presentWalletHasBalanceAlert, wallet]);

  const exportHistoryContent = useCallback(() => {
    const headers = [loc.transactions.date, loc.transactions.txid, `${loc.send.create_amount} (${XnaUnit.XNA})`, loc.send.create_memo];

    const rows = [headers.join(',')];
    const transactions = wallet.getTransactions();

    transactions.forEach((transaction: Transaction) => {
      const value = formatBalanceWithoutSuffix(transaction.value || 0, XnaUnit.XNA, true);
      const hash: string = transaction.hash || '';
      const memo = (transaction.hash && txMetadata[transaction.hash]?.memo?.trim()) || '';
      const date = transaction.timestamp ? new Date(transaction.timestamp * 1000).toString() : '';
      rows.push([date, hash, value, memo].join(','));
    });

    return rows.join('\n');
  }, [wallet, txMetadata]);

  const fileName = useMemo(() => {
    const label = wallet.getLabel().replace(' ', '-');
    return `${label}-history.csv`;
  }, [wallet]);

  const toolTipOnPressMenuItem = useCallback(
    async (id: string) => {
      if (id === CommonToolTipActions.Delete.id) {
        handleDeleteButtonTapped();
      } else if (id === CommonToolTipActions.Share.id) {
        await writeFileAndExport(fileName, exportHistoryContent(), true);
      } else if (id === CommonToolTipActions.SaveFile.id) {
        await writeFileAndExport(fileName, exportHistoryContent(), false);
      }
    },
    [exportHistoryContent, fileName, handleDeleteButtonTapped],
  );

  const toolTipActions = useMemo(() => {
    const actions: Action[] = [
      {
        id: loc.wallets.details_export_history,
        text: loc.wallets.details_export_history,
        displayInline: true,
        hidden: walletTransactionsLength === 0,
        subactions: [CommonToolTipActions.Share, CommonToolTipActions.SaveFile],
      },
      CommonToolTipActions.Delete,
    ];

    return actions;
  }, [walletTransactionsLength]);

  const HeaderRight = useMemo(
    () => <HeaderMenuButton disabled={isLoading} onPressMenuItem={toolTipOnPressMenuItem} actions={toolTipActions} />,
    [toolTipOnPressMenuItem, toolTipActions, isLoading],
  );

  useEffect(() => {
    setOptions({
      headerRight: () => HeaderRight,
    });
  }, [HeaderRight, setOptions]);

  // BIP47 contacts panel is no longer reachable on Neurai wallets.

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (isMasterFingerPrintVisible && wallet.allowMasterFingerprint && wallet.allowMasterFingerprint()) {
        // @ts-expect-error: Need to fix later
        if (wallet.getMasterFingerprintHex && !cancelled) {
          // @ts-expect-error: Need to fix later
          setMasterFingerprint(wallet.getMasterFingerprintHex());
        }
      } else {
        setMasterFingerprint(undefined);
      }

      return () => {
        cancelled = true;
      };
    }, [isMasterFingerPrintVisible, wallet]),
  );

  const stylesHook = StyleSheet.create({
    textLabel1: {
      color: colors.feeText,
      writingDirection: direction,
    },
    textLabel2: {
      color: colors.feeText,
      writingDirection: direction,
    },
    textValue: {
      color: colors.outputValue,
    },
    input: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
  });

  const navigateToWalletExport = () => {
    navigate('WalletExport', {
      walletID,
    });
  };

  const navigateToXPub = () =>
    navigate('WalletXpub', {
      walletID,
      xpub: wallet.getXpub(),
    });

  const navigateToAddresses = () =>
    navigate('WalletAddresses', {
      walletID,
    });

  const exportInternals = async () => {
    if (backdoorPressed < 10) return setBackdoorPressed(backdoorPressed + 1);
    setBackdoorPressed(0);
    const fileNameExternals = 'wallet-externals.json';
    const contents = JSON.stringify(
      {
        type: wallet.type,
        label: wallet.label,
        _utxo: wallet._utxo,
        _lastTxFetch: wallet._lastTxFetch,
        _lastBalanceFetch: wallet._lastBalanceFetch,
      },
      null,
      2,
    );
    await writeFileAndExport(fileNameExternals, contents, false);
  };

  const purgeTransactions = async () => {
    if (backdoorPressed < 10) return setBackdoorPressed(backdoorPressed + 1);
    setBackdoorPressed(0);
    wallet._utxo = [];
    wallet._lastTxFetch = 0;
    wallet._lastBalanceFetch = 0;
    presentAlert({ message: 'Cache purged. Go to the main screen and back to rerender.' });
  };

  const walletNameTextInputOnBlur = useCallback(async () => {
    const trimmedWalletName = walletName.trim();
    if (trimmedWalletName.length === 0) {
      const walletLabel = wallet.getLabel();
      setWalletName(walletLabel);
    } else if (wallet.getLabel() !== trimmedWalletName) {
      // Only save if the name has changed
      wallet.setLabel(trimmedWalletName);
      try {
        console.warn('saving wallet name:', trimmedWalletName);
        await saveToDisk();
      } catch (error) {
        console.error((error as Error).message);
      }
    }
  }, [wallet, walletName, saveToDisk]);

  usePreventRemove(false, () => {
    walletNameTextInputOnBlur();
  });

  const onViewMasterFingerPrintPress = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsMasterFingerPrintVisible(true);
  };

  return (
    <SafeAreaScrollView centerContent={isLoading} testID="WalletDetailsScroll">
      <>
        {isLoading ? (
          <BlueLoading />
        ) : (
          <>
            <BlueCard style={styles.address}>
              <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.add_wallet_name.toLowerCase()}</Text>
              <View style={[styles.input, stylesHook.input]}>
                <TextInput
                  value={walletName}
                  onChangeText={(text: string) => {
                    setWalletName(text);
                  }}
                  onChange={event => {
                    const text = event.nativeEvent.text;
                    setWalletName(text);
                  }}
                  onBlur={walletNameTextInputOnBlur}
                  numberOfLines={1}
                  placeholderTextColor="#81868e"
                  style={[styles.inputText, { writingDirection: direction }]}
                  editable={!isLoading}
                  underlineColorAndroid="transparent"
                  testID="WalletNameInput"
                />
              </View>
              <BlueSpacing20 />
              <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.wallets.details_type.toLowerCase()}</Text>
              <Text style={[styles.textValue, stylesHook.textValue]} selectable>
                {wallet.typeReadable}
              </Text>
              <BlueSpacing20 />
              <>
                <Text onPress={exportInternals} style={[styles.textLabel2, stylesHook.textLabel2]}>
                  {loc.transactions.list_title.toLowerCase()}
                </Text>
                <View style={styles.hardware}>
                  <BlueText>{loc.wallets.details_display}</BlueText>
                  <Switch
                    value={hideTransactionsInWalletsList}
                    onValueChange={async (value: boolean) => {
                      if (wallet.setHideTransactionsInWalletsList) {
                        wallet.setHideTransactionsInWalletsList(!value);
                        triggerHapticFeedback(HapticFeedbackTypes.ImpactLight);
                        setHideTransactionsInWalletsList(!wallet.getHideTransactionsInWalletsList());
                      }
                      try {
                        await saveToDisk();
                      } catch (error: any) {
                        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
                        console.error(error.message);
                      }
                    }}
                  />
                </View>
              </>
              <>
                <Text onPress={purgeTransactions} style={[styles.textLabel2, stylesHook.textLabel2]} testID="PurgeBackdoorButton">
                  {loc.transactions.transactions_count.toLowerCase()}
                </Text>
                <BlueText>{wallet.getTransactions().length}</BlueText>
              </>

              <View>
                <View style={styles.row}>
                  {wallet.allowMasterFingerprint && wallet.allowMasterFingerprint() && (
                    <View style={styles.marginRight16}>
                      <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.details_master_fingerprint.toLowerCase()}</Text>
                      {isMasterFingerPrintVisible ? (
                        <BlueText selectable>{masterFingerprint ?? <ActivityIndicator />}</BlueText>
                      ) : (
                        <TouchableOpacity onPress={onViewMasterFingerPrintPress}>
                          <BlueText>{loc.multisig.view}</BlueText>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {derivationPath && (
                    <View>
                      <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.details_derivation_path}</Text>
                      <BlueText selectable testID="DerivationPath">
                        {derivationPath}
                      </BlueText>
                    </View>
                  )}
                </View>
              </View>
            </BlueCard>
            <ListItem onPress={navigateToAddresses} title={loc.wallets.details_show_addresses} chevron />
            <BlueCard style={styles.address}>
              <View>
                <BlueSpacing20 />
                <Button onPress={navigateToWalletExport} testID="WalletExport" title={loc.wallets.details_export_backup} />
                {wallet.allowXpub && wallet.allowXpub() && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton onPress={navigateToXPub} testID="XpubButton" title={loc.wallets.details_show_xpub} />
                  </>
                )}
                <BlueSpacing20 />
                <BlueSpacing20 />
              </View>
            </BlueCard>
          </>
        )}
      </>
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  address: {
    alignItems: 'center',
    flex: 1,
  },
  textLabel1: {
    fontWeight: '500',
    fontSize: 14,
    marginVertical: 12,
  },
  textLabel2: {
    fontWeight: '500',
    fontSize: 14,
    marginVertical: 16,
  },
  textValue: {
    fontWeight: '500',
    fontSize: 14,
  },
  input: {
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    alignItems: 'center',
    borderRadius: 4,
  },
  inputText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
    color: '#81868e',
  },
  hardware: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
  },
  marginRight16: {
    marginRight: 16,
  },
});

export default WalletDetails;
