import React, { useMemo, useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, LayoutAnimation, View } from 'react-native';
import { useStorage } from '../hooks/context/useStorage';
import loc, { formatBalanceWithoutSuffix } from '../loc';
import { XnaUnit } from '../models/xnaUnits';
import ToolTipMenu from './TooltipMenu';
import { CommonToolTipActions } from '../typings/CommonToolTipActions';
import { useSettings } from '../hooks/context/useSettings';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from './themes';

export const TotalWalletsBalancePreferredUnit = 'TotalWalletsBalancePreferredUnit';
export const TotalWalletsBalanceKey = 'TotalWalletsBalance';

const TotalWalletsBalance: React.FC = React.memo(() => {
  const { wallets } = useStorage();
  const {
    preferredFiatCurrency,
    isTotalBalanceEnabled,
    setIsTotalBalanceEnabledStorage,
    totalBalancePreferredUnit,
    setTotalBalancePreferredUnitStorage,
  } = useSettings();
  const { colors } = useTheme();

  const totalBalanceFormatted = useMemo(() => {
    const totalBalance = wallets.reduce((prev, curr) => {
      return curr.hideBalance ? prev : prev + (curr.getBalance() || 0);
    }, 0);
    return formatBalanceWithoutSuffix(totalBalance, totalBalancePreferredUnit, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, totalBalancePreferredUnit, preferredFiatCurrency]);

  const toolTipActions = useMemo(
    () => [
      {
        id: 'viewInActions',
        text: '',
        displayInline: true,
        subactions: [
          {
            ...CommonToolTipActions.ViewInFiat,
            text: loc.formatString(loc.total_balance_view.display_in_fiat, { currency: preferredFiatCurrency.endPointKey }),
            hidden: totalBalancePreferredUnit === XnaUnit.LOCAL_CURRENCY,
          },
          { ...CommonToolTipActions.ViewInSats, hidden: totalBalancePreferredUnit === XnaUnit.SATS },
          { ...CommonToolTipActions.ViewInBitcoin, hidden: totalBalancePreferredUnit === XnaUnit.XNA },
        ],
      },
      CommonToolTipActions.CopyAmount,
      CommonToolTipActions.Hide,
    ],
    [preferredFiatCurrency, totalBalancePreferredUnit],
  );

  const onPressMenuItem = useCallback(
    async (id: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      switch (id) {
        case CommonToolTipActions.ViewInFiat.id:
          await setTotalBalancePreferredUnitStorage(XnaUnit.LOCAL_CURRENCY);
          break;
        case CommonToolTipActions.ViewInSats.id:
          await setTotalBalancePreferredUnitStorage(XnaUnit.SATS);
          break;
        case CommonToolTipActions.ViewInBitcoin.id:
          await setTotalBalancePreferredUnitStorage(XnaUnit.XNA);
          break;
        case CommonToolTipActions.Hide.id:
          await setIsTotalBalanceEnabledStorage(false);
          break;
        case CommonToolTipActions.CopyAmount.id:
          Clipboard.setString(totalBalanceFormatted.toString());
          break;
        default:
          break;
      }
    },
    [setIsTotalBalanceEnabledStorage, totalBalanceFormatted, setTotalBalancePreferredUnitStorage],
  );

  const handleBalanceOnPress = useCallback(async () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const nextUnit =
      totalBalancePreferredUnit === XnaUnit.XNA
        ? XnaUnit.SATS
        : totalBalancePreferredUnit === XnaUnit.SATS
          ? XnaUnit.LOCAL_CURRENCY
          : XnaUnit.XNA;
    await setTotalBalancePreferredUnitStorage(nextUnit);
  }, [totalBalancePreferredUnit, setTotalBalancePreferredUnitStorage]);

  if (!isTotalBalanceEnabled) return null;

  return (
    <ToolTipMenu actions={toolTipActions} onPressMenuItem={onPressMenuItem} shouldOpenOnLongPress style={styles.menuContainer}>
      <View style={styles.container}>
        <Text style={styles.label}>{loc.wallets.total_balance}</Text>
        <TouchableOpacity onPress={handleBalanceOnPress}>
          <Text style={[styles.balance, { color: colors.foregroundColor }]}>
            {totalBalanceFormatted}{' '}
            {totalBalancePreferredUnit !== XnaUnit.LOCAL_CURRENCY && (
              <Text style={[styles.currency, { color: colors.foregroundColor }]}>{totalBalancePreferredUnit}</Text>
            )}
          </Text>
        </TouchableOpacity>
      </View>
    </ToolTipMenu>
  );
});

const styles = StyleSheet.create({
  menuContainer: {
    alignSelf: 'stretch',
  },
  container: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
    marginBottom: 2,
    color: '#9BA0A9',
  },
  balance: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  currency: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default TotalWalletsBalance;
