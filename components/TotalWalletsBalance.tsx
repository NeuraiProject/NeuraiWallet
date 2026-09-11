import React, { useMemo, useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, LayoutAnimation, View } from 'react-native';
import loc, { formatBalanceWithoutSuffix } from '../loc';
import { XnaUnit } from '../models/xnaUnits';
import ToolTipMenu from './TooltipMenu';
import { CommonToolTipActions } from '../typings/CommonToolTipActions';
import { useSettings } from '../hooks/context/useSettings';
import { useNetworkSelection } from '../hooks/useNetworkSelection';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from './themes';

export const TotalWalletsBalancePreferredUnit = 'TotalWalletsBalancePreferredUnit';
export const TotalWalletsBalanceKey = 'TotalWalletsBalance';

const TotalWalletsBalance: React.FC = React.memo(() => {
  const { visibleWallets, network } = useNetworkSelection();
  const {
    preferredFiatCurrency,
    isTotalBalanceEnabled,
    setIsTotalBalanceEnabledStorage,
    totalBalancePreferredUnit,
    setTotalBalancePreferredUnitStorage,
  } = useSettings();
  const { colors } = useTheme();

  // One number for the network on screen. The header switcher already names
  // it, so there is no badge and no second line for the other network.
  const totalSats = useMemo(
    () => visibleWallets.reduce((sum, w) => (w.hideBalance ? sum : sum + (w.getBalance() || 0)), 0),
    [visibleWallets],
  );

  const isTestnet = network === 'testnet';
  // Testnet XNA has no fiat value: converting it through the mainnet price
  // would print a misleading amount, so testnet always renders in XNA and the
  // fiat toggle is withheld.
  const effectiveUnit = isTestnet ? XnaUnit.XNA : totalBalancePreferredUnit;

  const headlineFormatted = useMemo(
    () => formatBalanceWithoutSuffix(totalSats, effectiveUnit, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalSats, effectiveUnit, preferredFiatCurrency],
  );

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
            hidden: isTestnet || totalBalancePreferredUnit === XnaUnit.LOCAL_CURRENCY,
          },
          { ...CommonToolTipActions.ViewInBitcoin, hidden: isTestnet || totalBalancePreferredUnit === XnaUnit.XNA },
        ],
      },
      CommonToolTipActions.CopyAmount,
      CommonToolTipActions.Hide,
    ],
    [preferredFiatCurrency, totalBalancePreferredUnit, isTestnet],
  );

  const onPressMenuItem = useCallback(
    async (id: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      switch (id) {
        case CommonToolTipActions.ViewInFiat.id:
          await setTotalBalancePreferredUnitStorage(XnaUnit.LOCAL_CURRENCY);
          break;
        case CommonToolTipActions.ViewInBitcoin.id:
          await setTotalBalancePreferredUnitStorage(XnaUnit.XNA);
          break;
        case CommonToolTipActions.Hide.id:
          await setIsTotalBalanceEnabledStorage(false);
          break;
        case CommonToolTipActions.CopyAmount.id:
          Clipboard.setString(headlineFormatted.toString());
          break;
        default:
          break;
      }
    },
    [setIsTotalBalanceEnabledStorage, headlineFormatted, setTotalBalancePreferredUnitStorage],
  );

  const handleBalanceOnPress = useCallback(async () => {
    // No meaningful fiat conversion on testnet, so the tap is a no-op rather
    // than flipping to a misleading value.
    if (isTestnet) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // Neurai has a large coin supply, so SATS produces unwieldy numbers in the
    // total view. Toggle is XNA <-> fiat only; if a previous build stored SATS,
    // normalise to XNA.
    const nextUnit = totalBalancePreferredUnit === XnaUnit.XNA ? XnaUnit.LOCAL_CURRENCY : XnaUnit.XNA;
    await setTotalBalancePreferredUnitStorage(nextUnit);
  }, [isTestnet, totalBalancePreferredUnit, setTotalBalancePreferredUnitStorage]);

  if (!isTotalBalanceEnabled) return null;

  return (
    <ToolTipMenu actions={toolTipActions} onPressMenuItem={onPressMenuItem} shouldOpenOnLongPress style={styles.menuContainer}>
      <View style={styles.container}>
        <Text style={styles.label}>{loc.wallets.total_balance}</Text>
        <TouchableOpacity onPress={handleBalanceOnPress}>
          {(() => {
            // Split into integer / decimal / suffix so the decimal portion can
            // render smaller (matches the wallet card treatment).
            const balanceText = String(headlineFormatted);
            const match = balanceText.match(/^([^.]*)(\.\d+)?(.*)$/);
            const intPart = match?.[1] ?? balanceText;
            // Total view: cap visible decimals at 4. Full precision is still
            // available in the Send screen's "Available" hint.
            const decRaw = match?.[2] ?? '';
            const decPart = decRaw.length > 5 ? decRaw.slice(0, 5) : decRaw;
            const suffix = match?.[3] ?? '';
            return (
              <Text style={[styles.balance, { color: colors.foregroundColor }]} numberOfLines={1} ellipsizeMode="tail">
                {intPart}
                {decPart ? <Text style={styles.balanceDecimal}>{decPart}</Text> : null}
                {suffix}{' '}
                {effectiveUnit !== XnaUnit.LOCAL_CURRENCY && (
                  <Text style={[styles.currency, { color: colors.foregroundColor }]}>{effectiveUnit}</Text>
                )}
              </Text>
            );
          })()}
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
    color: '#9BA0A9',
    marginBottom: 2,
  },
  balance: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  // Same treatment as the wallet card: decimals smaller than the integer so
  // long totals stay readable.
  balanceDecimal: {
    fontSize: 22,
  },
  currency: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default TotalWalletsBalance;
