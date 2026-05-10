import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { lazy } from 'react';

import navigationStyle, { CloseButtonPosition } from '../components/navigationStyle';
import { useTheme } from '../components/themes';
import loc from '../loc';
import { withLazySuspense } from './LazyLoadingIndicator';
import { ScanQRCodeParamList } from './DetailViewStackParamList';

export type AddWalletStackParamList = {
  AddWallet: undefined;
  PleaseBackup: {
    walletID: string;
  };
  ScanQRCode: ScanQRCodeParamList;
};

const Stack = createNativeStackNavigator<AddWalletStackParamList>();

const WalletsAdd = lazy(() => import('../screen/wallets/Add'));
const PleaseBackup = lazy(() => import('../screen/wallets/PleaseBackup'));
const ScanQRCode = lazy(() => import('../screen/send/ScanQRCode'));

const AddComponent = withLazySuspense(WalletsAdd);
const PleaseBackupComponent = withLazySuspense(PleaseBackup);
const ScanQRCodeComponent = withLazySuspense(ScanQRCode);

const AddWalletStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator initialRouteName="AddWallet">
      <Stack.Screen
        name="AddWallet"
        component={AddComponent}
        options={navigationStyle({
          closeButtonPosition: CloseButtonPosition.Left,
          title: loc.wallets.add_title,
        })(theme)}
      />
      <Stack.Screen
        name="PleaseBackup"
        component={PleaseBackupComponent}
        options={navigationStyle({
          gestureEnabled: false,
          headerBackVisible: false,
          title: loc.pleasebackup.title,
        })(theme)}
      />
      <Stack.Screen
        name="ScanQRCode"
        component={ScanQRCodeComponent}
        options={navigationStyle({
          headerShown: false,
          statusBarHidden: true,
          presentation: 'fullScreenModal',
          headerShadowVisible: false,
        })(theme)}
      />
    </Stack.Navigator>
  );
};

export default AddWalletStack;
