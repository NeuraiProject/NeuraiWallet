import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, View, Platform, PlatformColor, Text, StyleSheet, Image } from 'react-native';
import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import HeaderRightButton from '../components/HeaderRightButton';
import navigationStyle, { CloseButtonPosition } from '../components/navigationStyle';
import { useTheme } from '../components/themes';
import { useExtendedNavigation } from '../hooks/useExtendedNavigation';
import loc from '../loc';
import IsItMyAddress from '../screen/settings/IsItMyAddress';
import Broadcast from '../screen/settings/Broadcast';
import GenerateWord from '../screen/settings/GenerateWord';
import TransactionDetails from '../screen/transactions/TransactionDetails';
import TransactionStatus from '../screen/transactions/TransactionStatus';
import WalletAddresses from '../screen/wallets/WalletAddresses';
import WalletDetails from '../screen/wallets/WalletDetails';
import SelectWallet from '../screen/wallets/SelectWallet';
import WalletsList from '../screen/wallets/WalletsList';
import { DetailViewStack } from './index';
import SettingsButton from '../components/icons/SettingsButton';
import { useSettings } from '../hooks/context/useSettings';
import { useStorage } from '../hooks/context/useStorage';
import { WalletTransactionsStatus } from '../components/Context/StorageProvider';
import WalletTransactions from '../screen/wallets/WalletTransactions';
import AddWalletButton from '../components/AddWalletButton';
import Settings from '../screen/settings/Settings';
import Currency from '../screen/settings/Currency';
import GeneralSettings from '../screen/settings/GeneralSettings';
import PlausibleDeniability from '../screen/PlausibleDeniability';
import Licensing from '../screen/settings/Licensing';
import NetworkSettings from '../screen/settings/NetworkSettings';
import NeuraiBackendEdit from '../screen/settings/NeuraiBackendEdit';
import DepinRpcEdit from '../screen/settings/DepinRpcEdit';
import SettingsBlockExplorer from '../screen/settings/SettingsBlockExplorer';
import About from '../screen/settings/About';
// import DefaultView from '../screen/settings/DefaultView'; // Commented out - not accessible from UI
import ElectrumSettings from '../screen/settings/ElectrumSettings';
import EncryptStorage from '../screen/settings/EncryptStorage';
import Language from '../screen/settings/Language';
import NotificationSettings from '../screen/settings/NotificationSettings';
import SelfTest from '../screen/settings/SelfTest';
import ReleaseNotes from '../screen/settings/ReleaseNotes';
import SettingsTools from '../screen/settings/SettingsTools';
import PromptPasswordConfirmationSheet from '../screen/PromptPasswordConfirmationSheet';
import { useSizeClass, SizeClass } from '../blue_modules/sizeClass';
import getWalletTransactionsOptions from './helpers/getWalletTransactionsOptions';
import { isDesktop } from '../blue_modules/environment';
import * as BlueElectrum from '../blue_modules/BlueElectrum';
import { ConnectionPollContext } from './ConnectionPollContext';
import ManageWallets from '../screen/wallets/ManageWallets';
import ReceiveDetails from '../screen/receive/ReceiveDetails';
import ReceiveCustomAmountSheet from '../screen/receive/ReceiveCustomAmountSheet';
import SendNeurai from '../screen/send/SendNeurai';
import ImportNeurai from '../screen/wallets/ImportNeurai';

const NEURAI_LOGO = require('../img/addWallet/neurai.png');

const UpdatingLabel: React.FC<{ containerStyle: object; textStyle: object }> = ({ containerStyle, textStyle }) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <View style={containerStyle}>
      <Animated.Text style={[textStyle, { opacity }]}>{loc.transactions.updating}</Animated.Text>
    </View>
  );
};

const DetailViewStackScreensStack = () => {
  const theme = useTheme();
  const navigation = useExtendedNavigation();
  const { walletTransactionUpdateStatus } = useStorage();
  const { isElectrumDisabled } = useSettings();
  const { sizeClass } = useSizeClass();
  const [electrumConnected, setElectrumConnected] = useState<boolean | null>(null);

  const pollConnection = useCallback(async () => {
    if (isElectrumDisabled) return;
    const ok = await BlueElectrum.ping();
    setElectrumConnected(ok);
  }, [isElectrumDisabled]);

  useEffect(() => {
    if (isElectrumDisabled) {
      setElectrumConnected(null);
      return;
    }
    pollConnection();
  }, [isElectrumDisabled, pollConnection]);

  useEffect(() => {
    if (isElectrumDisabled) return;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        pollConnection();
      }
    });
    return () => subscription.remove();
  }, [isElectrumDisabled, pollConnection]);
  // When starting up in an unknown state, we optimistically rely on ping()
  // and the fast retry loop while disconnected. Slow health checks while connected
  // run only from WalletsList when that screen is focused (saves idle battery).

  useEffect(() => {
    if (isElectrumDisabled || electrumConnected !== false) return;
    const interval = setInterval(pollConnection, 3000);
    return () => clearInterval(interval);
  }, [isElectrumDisabled, electrumConnected, pollConnection]);

  const connectionPollContextValue = useMemo(() => ({ pollConnection }), [pollConnection]);

  const DetailButton = useMemo(() => <HeaderRightButton testID="DetailButton" disabled={true} title={loc.send.create_details} />, []);

  const navigateToAddWallet = useCallback(() => {
    navigation.navigate('AddWalletRoot');
  }, [navigation]);

  const RightBarButtons = useMemo(
    () =>
      sizeClass === SizeClass.Large ? (
        <AddWalletButton onPress={navigateToAddWallet} />
      ) : (
        <>
          <AddWalletButton onPress={navigateToAddWallet} />
          <View style={styles.width24} />
          <SettingsButton />
        </>
      ),
    [sizeClass, navigateToAddWallet],
  );

  const walletListScreenOptions = useMemo<NativeStackNavigationOptions>(() => {
    // The "Offline" and "Not connected" pills referred to BlueElectrum
    // health; Neurai goes through RPC and has its own status panel in
    // NetworkSettings, so the only header pill we still surface is the
    // transient "Updating…" indicator while a refresh is in flight.
    const isUpdating = walletTransactionUpdateStatus !== WalletTransactionsStatus.NONE;

    const renderHeaderLeft = () => (
      <View style={styles.walletListHeaderLeft}>
        <Image source={NEURAI_LOGO} style={styles.walletListHeaderLogo} resizeMode="contain" />
        <Text style={[styles.walletListHeaderTitle, { color: theme.colors.foregroundColor }]} numberOfLines={1}>
          Neurai Wallet
        </Text>
        {isUpdating && (
          <UpdatingLabel
            containerStyle={[styles.updatingLabelContainer, styles.walletListUpdatingLabel, { backgroundColor: theme.colors.lightButton }]}
            textStyle={[styles.updatingLabelText, { color: theme.colors.foregroundColor }]}
          />
        )}
      </View>
    );

    return {
      title: '',
      headerLargeTitle: false,
      headerShadowVisible: false,
      headerStyle: {
        backgroundColor: theme.colors.customHeader,
      },
      headerLeft: renderHeaderLeft,
      headerRight: () => (isDesktop ? undefined : RightBarButtons),
    };
  }, [RightBarButtons, theme.colors.customHeader, theme.colors.foregroundColor, theme.colors.lightButton, walletTransactionUpdateStatus]);

  const isIOSLightMode = Platform.OS === 'ios' && !theme.dark;
  const settingsCardColor = theme.colors.lightButton ?? theme.colors.modal ?? theme.colors.elevated ?? theme.colors.background;
  const settingsHeaderBackgroundColor = isIOSLightMode ? settingsCardColor : theme.colors.customHeader;

  // Consistent header configuration for all settings screens
  const getSettingsHeaderOptions = (title: string) => {
    // Use PlatformColor for iOS to match the Settings component, fallback to theme color
    const titleColor = Platform.OS === 'ios' ? PlatformColor('label') : theme.colors.foregroundColor;
    // Convert PlatformColor to string for TypeScript compatibility
    const titleColorString = typeof titleColor === 'string' ? titleColor : String(titleColor);
    return {
      title,
      headerBackButtonDisplayMode: 'default' as const,
      headerBackVisible: true, // Show back button on Android
      headerShadowVisible: false,
      headerLargeTitle: false,
      headerLargeTitleStyle: undefined,
      headerTitleStyle: {
        color: titleColorString,
      },
      headerTransparent: false,
      headerBlurEffect: undefined,
      headerStyle: {
        backgroundColor: settingsHeaderBackgroundColor,
      },
    };
  };

  return (
    <ConnectionPollContext.Provider value={connectionPollContextValue}>
      <DetailViewStack.Navigator
        initialRouteName="WalletsList"
        screenOptions={{ headerShadowVisible: false, animationTypeForReplace: 'push' }}
      >
        <DetailViewStack.Screen name="WalletsList" component={WalletsList} options={navigationStyle(walletListScreenOptions)(theme)} />
        <DetailViewStack.Screen name="WalletTransactions" component={WalletTransactions} options={getWalletTransactionsOptions} />
        <DetailViewStack.Screen
          name="WalletDetails"
          component={WalletDetails}
          options={navigationStyle({
            headerTitle: loc.wallets.details_title,
          })(theme)}
        />
        <DetailViewStack.Screen
          name="TransactionDetails"
          component={TransactionDetails}
          options={navigationStyle({
            headerStyle: {
              backgroundColor: theme.colors.customHeader,
            },
            headerTitle: loc.transactions.details_title,
          })(theme)}
        />
        <DetailViewStack.Screen
          name="TransactionStatus"
          component={TransactionStatus}
          initialParams={{
            hash: undefined,
            walletID: undefined,
          }}
          options={navigationStyle({
            headerStyle: {
              backgroundColor: theme.colors.customHeader,
            },
            headerTitle: '',
            headerRight: () => DetailButton,
            headerBackButtonDisplayMode: 'minimal',
          })(theme)}
        />
        <DetailViewStack.Screen
          name="SelectWallet"
          component={SelectWallet}
          options={navigationStyle({ title: loc.wallets.select_wallet })(theme)}
        />
        <DetailViewStack.Screen name="SendNeurai" component={SendNeurai} options={navigationStyle({ title: loc.send.header })(theme)} />
        <DetailViewStack.Screen
          name="ImportNeurai"
          component={ImportNeurai}
          options={navigationStyle({ title: loc.wallets.import_title })(theme)}
        />
        <DetailViewStack.Screen
          name="IsItMyAddress"
          component={IsItMyAddress}
          initialParams={{ address: undefined }}
          options={navigationStyle(getSettingsHeaderOptions(loc.is_it_my_address.title))(theme)}
        />
        <DetailViewStack.Screen
          name="Broadcast"
          component={Broadcast}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.network_broadcast))(theme)}
        />
        <DetailViewStack.Screen
          name="GenerateWord"
          component={GenerateWord}
          options={navigationStyle(getSettingsHeaderOptions(loc.autofill_word.title))(theme)}
        />
        <DetailViewStack.Screen
          name="WalletAddresses"
          component={WalletAddresses}
          options={navigationStyle({ title: loc.addresses.addresses_title })(theme)}
        />

        <DetailViewStack.Screen
          name="Settings"
          component={Settings}
          options={navigationStyle({
            title: loc.settings.header,
            headerBackButtonDisplayMode: 'minimal',
            headerBackTitle: '',
            headerShadowVisible: false,
            // headerLargeTitle is iOS-only, disable on Android for better compatibility with older versions
            headerLargeTitle: Platform.OS === 'ios',
            headerLargeTitleStyle:
              Platform.OS === 'ios'
                ? {
                    color:
                      typeof theme.colors.foregroundColor === 'string'
                        ? theme.colors.foregroundColor
                        : String(theme.colors.foregroundColor),
                  }
                : undefined,
            headerTitleStyle: {
              color: typeof theme.colors.foregroundColor === 'string' ? theme.colors.foregroundColor : String(theme.colors.foregroundColor),
            },
            headerTransparent: false,
            headerBlurEffect: undefined,
            headerStyle: {
              backgroundColor: settingsHeaderBackgroundColor,
            },
            animationTypeForReplace: 'push',
          })(theme)}
        />
        <DetailViewStack.Screen
          name="Currency"
          component={Currency}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.currency))(theme)}
        />
        <DetailViewStack.Screen
          name="GeneralSettings"
          component={GeneralSettings}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.general))(theme)}
        />
        <DetailViewStack.Screen
          name="PlausibleDeniability"
          component={PlausibleDeniability}
          options={navigationStyle(getSettingsHeaderOptions(loc.plausibledeniability.title))(theme)}
        />
        <DetailViewStack.Screen
          name="Licensing"
          component={Licensing}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.license))(theme)}
        />
        <DetailViewStack.Screen
          name="NetworkSettings"
          component={NetworkSettings}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.network))(theme)}
        />
        <DetailViewStack.Screen
          name="NeuraiBackendEdit"
          component={NeuraiBackendEdit}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.neurai_backend_edit_title))(theme)}
        />
        <DetailViewStack.Screen
          name="DepinRpcEdit"
          component={DepinRpcEdit}
          options={navigationStyle(getSettingsHeaderOptions(loc.depin.rpc_settings_title))(theme)}
        />
        <DetailViewStack.Screen
          name="SettingsBlockExplorer"
          component={SettingsBlockExplorer}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.block_explorer))(theme)}
        />

        <DetailViewStack.Screen
          name="About"
          component={About}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.about))(theme)}
        />
        {/* <DetailViewStack.Screen
        name="DefaultView"
        component={DefaultView}
        options={navigationStyle(getSettingsHeaderOptions(loc.settings.default_title))(theme)}
      /> */}
        <DetailViewStack.Screen
          name="ElectrumSettings"
          component={ElectrumSettings}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.electrum_settings_server))(theme)}
          initialParams={{ server: undefined }}
        />
        <DetailViewStack.Screen
          name="EncryptStorage"
          component={EncryptStorage}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.encrypt_title))(theme)}
        />
        <DetailViewStack.Screen
          name="Language"
          component={Language}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.language))(theme)}
        />
        <DetailViewStack.Screen
          name="NotificationSettings"
          component={NotificationSettings}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.notifications))(theme)}
        />
        <DetailViewStack.Screen
          name="SelfTest"
          component={SelfTest}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.selfTest))(theme)}
        />
        <DetailViewStack.Screen
          name="ReleaseNotes"
          component={ReleaseNotes}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.about_release_notes))(theme)}
        />
        <DetailViewStack.Screen
          name="SettingsTools"
          component={SettingsTools}
          options={navigationStyle(getSettingsHeaderOptions(loc.settings.tools))(theme)}
        />
        <DetailViewStack.Screen
          name="PromptPasswordConfirmationSheet"
          component={PromptPasswordConfirmationSheet}
          options={navigationStyle({
            title: loc.settings.password,
            presentation: 'formSheet',
            sheetAllowedDetents: Platform.OS === 'ios' ? 'fitToContents' : [0.9],
            sheetGrabberVisible: true,
            closeButtonPosition: CloseButtonPosition.Right,
            headerBackButtonDisplayMode: 'minimal',
          })(theme)}
        />
        <DetailViewStack.Screen
          name="ManageWallets"
          component={ManageWallets}
          options={{
            presentation: 'fullScreenModal',
            title: loc.wallets.manage_title,
            headerShown: true,
          }}
        />
        <DetailViewStack.Screen
          name="ReceiveDetails"
          component={ReceiveDetails}
          options={navigationStyle({
            title: loc.receive.header,
            closeButtonPosition: CloseButtonPosition.Left,
            headerShown: true,
            presentation: 'modal',
          })(theme)}
        />
        <DetailViewStack.Screen
          name="ReceiveCustomAmount"
          component={ReceiveCustomAmountSheet}
          options={navigationStyle({
            presentation: 'formSheet',
            sheetAllowedDetents: Platform.OS === 'ios' ? 'fitToContents' : [0.9],
            headerTitle: loc.receive.details_setAmount,
            sheetGrabberVisible: true,
            closeButtonPosition: CloseButtonPosition.Right,
          })(theme)}
        />
      </DetailViewStack.Navigator>
    </ConnectionPollContext.Provider>
  );
};

export default DetailViewStackScreensStack;

const styles = StyleSheet.create({
  width24: {
    width: 24,
  },
  walletListHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  walletListHeaderLogo: {
    width: 29,
    height: 29,
    marginRight: 8,
  },
  walletListHeaderTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  walletListUpdatingLabel: {
    marginLeft: 10,
  },
  updatingLabelContainer: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  updatingLabelText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
