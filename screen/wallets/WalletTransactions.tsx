import { RouteProp, useFocusEffect, useRoute, useLocale } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  findNodeHandle,
  FlatList,
  InteractionManager,
  Platform,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from '../../components/Icon';
import { isDesktop } from '../../blue_modules/environment';
import * as fs from '../../blue_modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import presentAlert, { AlertType } from '../../components/Alert';
import AssetsList from '../../components/AssetsList';
import DePINChat, { DePINChatHandle } from '../../components/DePINChat';
import { isDepinChatSupportedNetwork } from '../../blue_modules/neurai/depinChatIdentity';
import { FButton, FContainer, FloatButtonsBottomFade } from '../../components/FloatButtons';
import { useTheme } from '../../components/themes';
import { TransactionListItem } from '../../components/TransactionListItem';
import TransactionsNavigationHeader from '../../components/TransactionsNavigationHeader';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc, { formatBalance } from '../../loc';
import { Chain } from '../../models/xnaUnits';
import ActionSheet from '../ActionSheet';
import { useStorage } from '../../hooks/context/useStorage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { Transaction } from '../../class/wallets/types';
import getWalletTransactionsOptions, { WalletTransactionsRouteProps } from '../../navigation/helpers/getWalletTransactionsOptions';
import useMenuElements from '../../hooks/useMenuElements';
import useWalletSubscribe from '../../hooks/useWalletSubscribe';
import useDepinPoolWatch from '../../hooks/useDepinPoolWatch';
import { getClipboardContent } from '../../blue_modules/clipboard';
import HandOffComponent from '../../components/HandOffComponent';
import { HandOffActivityType } from '../../components/types';
import WalletGradient from '../../class/wallet-gradient';

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

type RouteProps = RouteProp<DetailViewStackParamList, 'WalletTransactions'>;

type WalletTransactionsProps = NativeStackScreenProps<DetailViewStackParamList, 'WalletTransactions'>;

type TransactionListItem = Transaction & { type: 'transaction' | 'header' };
const WalletTransactions: React.FC<WalletTransactionsProps> = ({ route }: { route: WalletTransactionsRouteProps }) => {
  const { saveToDisk } = useStorage();
  const { registerTransactionsHandler, unregisterTransactionsHandler } = useMenuElements();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const { direction } = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const { params } = useRoute<RouteProps>();
  const { walletID } = params;
  const wallet = useWalletSubscribe(walletID);
  const [limit, setLimit] = useState(15);
  const [pageSize] = useState(20);
  const navigation = useExtendedNavigation();
  const { setOptions, navigate } = navigation;
  const { colors } = useTheme();
  const walletActionButtonsRef = useRef<View>(null);
  const [lastFetchTimestamp, setLastFetchTimestamp] = useState(() => wallet._lastTxFetch || 0);
  const [fetchFailures, setFetchFailures] = useState(0);
  const [balance, setBalance] = useState(wallet.getBalance());
  const [displayUnit, setDisplayUnit] = useState(wallet.preferredBalanceUnit);
  const [isUnitSwitching, setIsUnitSwitching] = useState(false);
  // All Neurai wallets (including the hardware wallet, which reads assets via
  // the backend) get a Transactions / Assets tab switch in the list header.
  const showAssetsTab = isNeuraiWallet(wallet);
  // DePIN chat is Legacy-only (PQ networks have no BIP44 chat identity).
  const showDepinTab = isNeuraiWallet(wallet) && isDepinChatSupportedNetwork(wallet.network);
  const [activeTab, setActiveTab] = useState<'transactions' | 'assets' | 'depin'>('transactions');
  const MAX_FAILURES = 3;
  const flatListRef = useRef<FlatList<Transaction>>(null);
  const depinChatRef = useRef<DePINChatHandle>(null);

  // Cheap "new messages" marker: polls only the unencrypted pool stats once a
  // minute, so it never needs an identity, a session or the hardware wallet.
  // Decryption still happens only when the user opens the chat.
  const { hasNewMessages: hasNewDepinMessages } = useDepinPoolWatch({
    enabled: showDepinTab,
    network: isNeuraiWallet(wallet) ? wallet.getNeuraiNetwork() : 'mainnet',
  });

  // On the DePIN tab, back (hardware button or header arrow) walks one level
  // at a time instead of leaving the screen: open token chat → token picker
  // (handled by DePINChat.goBack()) → the wallet's Transactions tab → and only
  // from there does the screen actually pop.
  const isDepinTabActive = showDepinTab && activeTab === 'depin';
  const handleDepinBack = useCallback((): boolean => {
    if (!isDepinTabActive) return false;
    if (!depinChatRef.current?.goBack()) setActiveTab('transactions');
    return true;
  }, [isDepinTabActive]);
  useFocusEffect(
    useCallback(() => {
      if (!isDepinTabActive) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', handleDepinBack);
      return () => sub.remove();
    }, [isDepinTabActive, handleDepinBack]),
  );
  useEffect(() => {
    if (!isDepinTabActive) return;
    return navigation.addListener('beforeRemove', (e: any) => {
      const actionType = e?.data?.action?.type;
      if (actionType !== 'GO_BACK' && actionType !== 'POP') return;
      if (handleDepinBack()) e.preventDefault();
    });
  }, [navigation, isDepinTabActive, handleDepinBack]);
  const headerRef = useRef<View>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const refreshInProgressRef = useRef(false);

  const stylesHook = StyleSheet.create({
    listHeaderText: {
      color: colors.foregroundColor,
    },
    tabActiveBg: {
      // Same tone as the list/content area so the active tab reads as part of it.
      backgroundColor: colors.background,
    },
    tabInactiveBg: {
      // Muted/greyed tone + visible outline for the unselected tab.
      backgroundColor: colors.inputBackgroundColor,
      borderColor: colors.formBorder,
    },
    tabLabelActive: {
      color: colors.foregroundColor,
    },
    tabLabelInactive: {
      color: colors.alternativeTextColor,
    },
    listFooterStyle: {
      height: '100%',
      backgroundColor: colors.background,
    },
    backgroundContainer: {
      backgroundColor: colors.background,
    },
    gradientBackground: {
      backgroundColor: headerHeight > 0 ? WalletGradient.headerColorForWallet(wallet) : colors.background,
      height: headerHeight > 0 ? headerHeight : '30%',
    },
    activityIndicatorStyle: {
      backgroundColor: colors.background,
    },
    sendIcon: { transform: [{ rotate: direction === 'rtl' ? '-225deg' : '225deg' }] },
    receiveIcon: { transform: [{ rotate: direction === 'rtl' ? '-45deg' : '45deg' }] },
    headerBottomBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 12,
      height: 12,
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      ...Platform.select({
        ios: {
          shadowColor: colors.shadowColor,
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.1,
          shadowRadius: 6,
        },
        android: {
          elevation: 0.5,
        },
      }),
    },
  });

  useFocusEffect(
    useCallback(() => {
      setOptions(getWalletTransactionsOptions({ route }));
    }, [route, setOptions]),
  );

  const onBarCodeRead = useCallback(
    (ret?: { data?: any }) => {
      if (isLoading) return;
      setIsLoading(true);
      const uri: string | undefined = ret?.data ? ret.data : (ret as unknown as string | undefined);
      navigate('SendNeurai', {
        walletID,
        address: typeof uri === 'string' ? uri : undefined,
      });
      setIsLoading(false);
    },
    [isLoading, walletID, navigate],
  );

  useEffect(() => {
    const data = route.params?.onBarScanned;
    if (data) {
      onBarCodeRead({ data });
      navigation.setParams({ onBarScanned: undefined });
    }
  }, [navigation, onBarCodeRead, route.params]);

  useEffect(() => {
    // keep local display unit in sync when wallet changes (e.g., switching wallets)
    console.debug('[UnitSwitch] sync from wallet preferred unit', { walletID, preferred: wallet.preferredBalanceUnit });
    setDisplayUnit(wallet.preferredBalanceUnit);
  }, [wallet, walletID]);

  useEffect(() => {
    console.debug('[UnitSwitch] display unit state changed', { walletID, displayUnit, switching: isUnitSwitching });
  }, [walletID, displayUnit, isUnitSwitching]);

  const sortedTransactions = useMemo(() => {
    const txs = wallet.getTransactions().slice();
    txs.sort((a, b) => b.timestamp - a.timestamp);
    return txs;
  }, [wallet]);

  const getTransactions = useCallback((lmt = Infinity): Transaction[] => sortedTransactions.slice(0, lmt), [sortedTransactions]);

  const loadMoreTransactions = useCallback(() => {
    if (getTransactions(Infinity).length > limit) {
      setLimit(prev => prev + pageSize);
    }
  }, [getTransactions, limit, pageSize]);

  const refreshTransactions = useCallback(
    async (isManualRefresh = false) => {
      console.debug('refreshTransactions, ', wallet.getLabel());
      // Neurai wallets fetch through the Neurai backend, not BlueElectrum, so the
      // legacy "Electrum disabled" toggle no longer applies — only skip when
      // we're already mid-refresh.
      if (refreshInProgressRef.current) return;

      const MIN_REFRESH_INTERVAL = 5000; // 5 seconds
      if (!isManualRefresh && lastFetchTimestamp !== 0 && Date.now() - lastFetchTimestamp < MIN_REFRESH_INTERVAL) {
        return; // Prevent auto-refreshing if last fetch was too recent
      }

      if (fetchFailures >= MAX_FAILURES && !isManualRefresh) {
        return; // Silently stop auto-retrying, but allow manual refresh
      }

      refreshInProgressRef.current = true;
      // Only show loading indicator on manual refresh or after first successful fetch
      if (isManualRefresh || lastFetchTimestamp !== 0) {
        setIsLoading(true);
      }

      let smthChanged = false;
      try {
        // BIP47 / Electrum wait-till-connected were Bitcoin pipeline steps;
        // Neurai wallets fetch via the Neurai backend directly.
        const oldBalance = wallet.getBalance();
        await wallet.fetchBalance();
        if (oldBalance !== wallet.getBalance()) smthChanged = true;
        const oldTxLen = wallet.getTransactions().length;
        await wallet.fetchTransactions();
        if (oldTxLen !== wallet.getTransactions().length) smthChanged = true;

        // Success - reset failure counter and update timestamps
        setFetchFailures(0);
        const newTimestamp = Date.now();
        setLastFetchTimestamp(newTimestamp);
      } catch (err: any) {
        const errorMessage: string = err.message;
        setFetchFailures(prev => {
          const newFailures = prev + 1;
          // Only show error on final attempt for automatic refresh
          if ((isManualRefresh || newFailures === MAX_FAILURES) && newFailures >= MAX_FAILURES) {
            if (errorMessage) {
              presentAlert({ message: errorMessage, type: AlertType.Toast });
            }
          }
          return newFailures;
        });
      } finally {
        try {
          if (smthChanged) {
            await saveToDisk();
            setLimit(prev => prev + pageSize);
          }
        } finally {
          refreshInProgressRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [wallet, saveToDisk, pageSize, lastFetchTimestamp, fetchFailures],
  );

  // Catch-up on focus: just open the WSS connection and subscribe this
  // wallet's addresses. The backend compares the per-address `status` hash
  // returned by the server against what we last persisted and only pushes a
  // synthetic address.changed when something actually moved while we were
  // closed; the push handler then runs the heavy refetch in the background.
  // No periodic polling and no blocking fetch on the focus tick — the UI
  // stays responsive while subscription is in flight.
  useFocusEffect(
    useCallback(() => {
      if (isNeuraiWallet(wallet)) {
        // Open the WSS connection and refresh the per-address subscription
        // diff so server pushes flow back here. `setSubscribedAddresses` is a
        // no-op when the home screen has already established the connection
        // for this wallet, so re-entering a wallet is essentially free.
        const handle = InteractionManager.runAfterInteractions(() => {
          wallet.ensureBackendConnected().catch(err => {
            console.debug('[WalletTransactions] ensureBackendConnected failed', err);
          });
        });
        return () => handle.cancel();
      }
      refreshTransactions(false).catch(console.error);
      return undefined;
    }, [wallet, refreshTransactions]),
  );

  const renderListFooterComponent = () => {
    // if not all txs rendered - display indicator
    return wallet.getTransactions().length > limit ? (
      <ActivityIndicator style={[styles.activityIndicator, stylesHook.activityIndicatorStyle]} />
    ) : (
      <View style={stylesHook.listFooterStyle} />
    );
  };

  const navigateToSendScreen = () => {
    if (isNeuraiWallet(wallet)) {
      navigate('SendNeurai', { walletID });
      return;
    }
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID,
      },
    });
  };

  const getItemLayout = (_: any, index: number) => ({
    length: 64,
    offset: 64 * index,
    index,
  });

  const renderItem = useCallback(
    // eslint-disable-next-line react/no-unused-prop-types
    ({ item }: { item: Transaction }) => (
      <TransactionListItem key={item.hash} item={item} itemPriceUnit={displayUnit} walletID={walletID} />
    ),
    [displayUnit, walletID],
  );

  const choosePhoto = () => {
    fs.showImagePickerAndReadImage()
      .then(data => {
        if (data) {
          onBarCodeRead({ data });
        }
      })
      .catch(error => {
        console.log(error);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.errors.error, message: error.message });
      });
  };

  const _keyExtractor = useCallback((_item: any, index: number) => index.toString(), []);

  const pasteFromClipboard = async () => {
    onBarCodeRead({ data: await getClipboardContent() });
  };

  const sendButtonPress = () => {
    navigateToSendScreen();
  };

  const sendButtonLongPress = async () => {
    const isClipboardEmpty = (await getClipboardContent())?.trim().length === 0;
    const options = [loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan];
    const cancelButtonIndex = 0;

    if (!isClipboardEmpty) {
      options.push(loc.wallets.paste_from_clipboard);
    }

    ActionSheet.showActionSheetWithOptions(
      {
        title: loc.send.header,
        options,
        cancelButtonIndex,
        anchor: findNodeHandle(walletActionButtonsRef.current) ?? undefined,
      },
      async buttonIndex => {
        switch (buttonIndex) {
          case 0:
            break;
          case 1: {
            choosePhoto();
            break;
          }
          case 2: {
            navigate('ScanQRCode', {
              showImportFileButton: true,
            });
            break;
          }
          case 3:
            if (!isClipboardEmpty) {
              pasteFromClipboard();
            }
            break;
        }
      },
    );
  };

  useEffect(() => {
    const screenKey = `WalletTransactions-${walletID}`;
    registerTransactionsHandler(() => refreshTransactions(true), screenKey);

    return () => {
      unregisterTransactionsHandler(screenKey);
    };
  }, [walletID, refreshTransactions, registerTransactionsHandler, unregisterTransactionsHandler]);

  useFocusEffect(
    useCallback(() => {
      const screenKey = `WalletTransactions-${walletID}`;

      return () => {
        unregisterTransactionsHandler(screenKey);
      };
    }, [walletID, unregisterTransactionsHandler]),
  );

  useEffect(() => {
    const interval = setInterval(() => setBalance(wallet.getBalance()), 1000);
    return () => clearInterval(interval);
  }, [wallet]);

  const walletBalance = useMemo(() => {
    if (wallet.hideBalance) return '';
    if (!Number.isFinite(balance)) return '';
    const formatted = formatBalance(balance, displayUnit, true);
    return formatted || '0';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, wallet.hideBalance, displayUnit, balance]);

  const handleScroll = useCallback(
    (event: any) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const combinedHeight = 180;
      if (offsetY < combinedHeight) {
        setOptions({ ...getWalletTransactionsOptions({ route }), headerTitle: undefined });
      } else {
        navigation.setOptions({
          headerTitle: `${wallet.getLabel()} ${walletBalance}`,
        });
      }
    },
    [navigation, wallet, walletBalance, setOptions, route],
  );

  const measureHeaderHeight = useCallback(() => {
    if (!headerRef.current) {
      // If header ref is not available, use default background
      setHeaderHeight(0);
      return;
    }

    headerRef.current.measure((x, y, width, height, pageX, pageY) => {
      // Check if the header is actually visible
      if (height === 0 || pageY < 0) {
        // Header is not visible, use default background
        setHeaderHeight(0);
        return;
      }

      const fullHeight = pageY + height;
      if (fullHeight > 0) {
        setHeaderHeight(fullHeight);
      }
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(measureHeaderHeight, 100);
    return () => clearTimeout(timer);
  }, [walletID, measureHeaderHeight]);

  const ListHeaderComponent = useCallback(
    () => (
      <View ref={headerRef} onLayout={measureHeaderHeight}>
        <TransactionsNavigationHeader
          wallet={wallet}
          onWalletUnitChange={async selectedUnit => {
            console.debug('[UnitSwitch] requested', { walletID, from: displayUnit, to: selectedUnit });
            setIsUnitSwitching(true);
            setDisplayUnit(selectedUnit);
            if ('setPreferredBalanceUnit' in wallet) {
              wallet.setPreferredBalanceUnit(selectedUnit);
            } else {
              (wallet as any).preferredBalanceUnit = selectedUnit;
            }
            await saveToDisk();
            console.debug('[UnitSwitch] persisted preferred unit', { walletID, unit: selectedUnit });
            setTimeout(() => {
              setIsUnitSwitching(false);
              console.debug('[UnitSwitch] complete', { walletID, unit: selectedUnit });
            }, 50);
          }}
          unit={displayUnit}
          unitSwitching={isUnitSwitching}
          onWalletBalanceVisibilityChange={async isShouldBeVisible => {
            const isBiometricsEnabled = await isBiometricUseCapableAndEnabled();
            if (wallet.hideBalance && isBiometricsEnabled) {
              const unlocked = await unlockWithBiometrics();
              if (!unlocked) throw new Error('Biometrics failed');
            }
            wallet.hideBalance = isShouldBeVisible;
            await saveToDisk();
          }}
          onManageFundsPressed={() => {}}
        />
        <View style={styles.headerBottomBarSpacer}>
          <View style={stylesHook.headerBottomBar} />
        </View>
        <View style={[styles.flex, stylesHook.backgroundContainer]}>
          {showAssetsTab ? (
            <View style={styles.tabsBar}>
              {(
                (showDepinTab ? (['transactions', 'assets', 'depin'] as const) : (['transactions', 'assets'] as const)) as readonly (
                  | 'transactions'
                  | 'assets'
                  | 'depin'
                )[]
              ).map(tab => {
                const active = activeTab === tab;
                const label =
                  tab === 'transactions' ? loc.assets.tab_transactions : tab === 'assets' ? loc.assets.tab_assets : loc.assets.tab_depin;
                return (
                  <Pressable
                    key={tab}
                    testID={`WalletTab-${tab}`}
                    onPress={() => setActiveTab(tab)}
                    style={[
                      styles.tab,
                      active ? [styles.tabActive, stylesHook.tabActiveBg] : [styles.tabInactive, stylesHook.tabInactiveBg],
                    ]}
                  >
                    {active && (
                      <LinearGradient
                        colors={['rgba(249, 115, 22, 0.5)', 'rgba(249, 115, 22, 0)']}
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                      />
                    )}
                    <Text style={[styles.tabLabel, active ? stylesHook.tabLabelActive : stylesHook.tabLabelInactive]}>{label}</Text>
                    {tab === 'depin' && hasNewDepinMessages && <View style={styles.depinUnreadDot} testID="DepinTabUnreadDot" />}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.listHeaderTextRow}>
              <Text style={[styles.listHeaderText, stylesHook.listHeaderText]}>{loc.transactions.list_title}</Text>
            </View>
          )}
        </View>
      </View>
    ),
    [
      wallet,
      walletID,
      displayUnit,
      isUnitSwitching,
      measureHeaderHeight,
      stylesHook.backgroundContainer,
      stylesHook.headerBottomBar,
      stylesHook.listHeaderText,
      stylesHook.tabActiveBg,
      stylesHook.tabInactiveBg,
      stylesHook.tabLabelActive,
      stylesHook.tabLabelInactive,
      saveToDisk,
      isBiometricUseCapableAndEnabled,
      showAssetsTab,
      showDepinTab,
      activeTab,
      hasNewDepinMessages,
    ],
  );

  useEffect(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [walletID]);

  return (
    <View style={[styles.flex, stylesHook.backgroundContainer]}>
      <View style={[styles.refreshIndicatorBackground, stylesHook.gradientBackground]} testID="TransactionsListView" />
      {showDepinTab && activeTab === 'depin' ? (
        <View style={[styles.flex, stylesHook.backgroundContainer]}>
          <ListHeaderComponent />
          <DePINChat ref={depinChatRef} walletID={walletID} />
        </View>
      ) : showAssetsTab && activeTab === 'assets' ? (
        <AssetsList walletID={walletID} ListHeaderComponent={ListHeaderComponent} />
      ) : (
        <FlatList<Transaction>
          ref={flatListRef}
          getItemLayout={getItemLayout}
          updateCellsBatchingPeriod={50}
          onEndReachedThreshold={0.3}
          onEndReached={loadMoreTransactions}
          ListFooterComponent={renderListFooterComponent}
          data={getTransactions(limit)}
          extraData={[wallet, displayUnit, wallet.hideBalance]}
          keyExtractor={_keyExtractor}
          renderItem={renderItem}
          initialNumToRender={10}
          removeClippedSubviews
          contentContainerStyle={stylesHook.backgroundContainer}
          contentInset={{ top: 0, left: 0, bottom: 90, right: 0 }}
          maxToRenderPerBatch={10}
          onScroll={handleScroll}
          windowSize={15}
          scrollEventThrottle={16}
          ListHeaderComponent={ListHeaderComponent}
          ListEmptyComponent={
            <ScrollView style={[styles.emptyTxsContainer, stylesHook.backgroundContainer]} contentContainerStyle={styles.scrollViewContent}>
              <Text numberOfLines={0} style={styles.emptyTxs} testID="TransactionsListEmpty">
                {loc.wallets.list_empty_txs1}
              </Text>
            </ScrollView>
          }
          refreshControl={
            !isDesktop ? (
              <RefreshControl refreshing={isLoading} onRefresh={() => refreshTransactions(true)} tintColor={colors.msSuccessCheck} />
            ) : undefined
          }
        />
      )}

      {/* The DePIN chat owns the bottom of the screen (message input toolbar), so
          hide the floating Send/Receive actions there — they'd overlap the input
          and the latest messages. They remain on the Transactions/Assets tabs. */}
      {!(showDepinTab && activeTab === 'depin') && (
        <>
          <FloatButtonsBottomFade />
          <FContainer ref={walletActionButtonsRef}>
            {wallet.allowReceive() && (
              <FButton
                testID="ReceiveButton"
                text={loc.receive.header}
                onPress={() => {
                  navigate('ReceiveDetails', { walletID });
                }}
                icon={
                  <View style={styles.iconContainer}>
                    <Icon
                      name="arrow-down"
                      size={buttonFontSize}
                      type="font-awesome"
                      color={colors.buttonTextColor}
                      style={stylesHook.receiveIcon}
                    />
                  </View>
                }
              />
            )}
            {wallet.allowSend() && (
              <FButton
                onLongPress={sendButtonLongPress}
                onPress={sendButtonPress}
                text={loc.send.header}
                testID="SendButton"
                icon={
                  <View style={styles.iconContainer}>
                    <Icon
                      name="arrow-down"
                      size={buttonFontSize}
                      type="font-awesome"
                      color={colors.buttonTextColor}
                      style={stylesHook.sendIcon}
                    />
                  </View>
                }
              />
            )}
          </FContainer>
        </>
      )}
      {wallet.chain === Chain.ONCHAIN && wallet.getXpub && wallet.getXpub() ? (
        <HandOffComponent
          title={wallet.getLabel()}
          type={HandOffActivityType.Xpub}
          url={`https://www.blockonomics.co/#/search?q=${wallet.getXpub()}`}
        />
      ) : null}
    </View>
  );
};

export default WalletTransactions;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerBottomBarSpacer: { position: 'relative', height: 12 },
  scrollViewContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 500 },
  activityIndicator: { marginVertical: 20 },
  listHeaderTextRow: { flex: 1, marginHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between' },
  tabsBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 2, columnGap: 8 },
  // Same green marker the chat uses for unread conversations.
  depinUnreadDot: { position: 'absolute', top: 8, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  // Selected tab: merges with the content tone, marked by a soft Neurai-orange
  // gradient fading down from the top. `overflow: hidden` clips the gradient to
  // the rounded top corners.
  tabActive: { overflow: 'hidden' },
  // Unselected tab: outlined, muted background (set via stylesHook).
  tabInactive: { borderWidth: 1 },
  tabLabel: { fontSize: 15, fontWeight: '700' },
  listHeaderText: { marginTop: 0, marginBottom: 16, fontWeight: 'bold', fontSize: 24 },
  refreshIndicatorBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  emptyTxsContainer: { height: '10%', minHeight: '10%', flex: 1 },
  emptyTxs: { fontSize: 18, color: '#9aa0aa', textAlign: 'center', marginVertical: 16 },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: buttonFontSize * 1.5,
    height: buttonFontSize * 1.5,
    overflow: 'visible',
  },
});
