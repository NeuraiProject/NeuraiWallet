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
import { isNeuraiWallet } from '../class/wallets/is-neurai-wallet';
import { isTestnetChain } from '../blue_modules/neurai/networkConfig';

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

  // Split wallet balances by chain. Non-Neurai wallets (if any sneak through
  // legacy code paths) get bucketed as mainnet so we never silently drop XNA
  // from the headline number.
  const { mainnetSats, testnetSats } = useMemo(() => {
    let main = 0;
    let test = 0;
    for (const w of wallets) {
      if (w.hideBalance) continue;
      const sats = w.getBalance() || 0;
      const isTestnet = isNeuraiWallet(w) && isTestnetChain(w.network);
      if (isTestnet) test += sats;
      else main += sats;
    }
    return { mainnetSats: main, testnetSats: test };
  }, [wallets]);

  const hasMainnet = mainnetSats > 0;
  const hasTestnet = testnetSats > 0;
  // If the user has *only* testnet wallets, promote testnet to the headline so
  // the total card isn't a permanent zero. We still tag it as TESTNET below.
  const headlineSats = hasMainnet || !hasTestnet ? mainnetSats : testnetSats;
  const headlineIsTestnet = !hasMainnet && hasTestnet;
  // Testnet XNA has no real fiat value, so when the headline is testnet we
  // always render in XNA regardless of the persisted preference — converting
  // testnet sats through the mainnet price would show a misleading euro/dollar
  // amount.
  const effectiveUnit = headlineIsTestnet ? XnaUnit.XNA : totalBalancePreferredUnit;

  const headlineFormatted = useMemo(
    () => formatBalanceWithoutSuffix(headlineSats, effectiveUnit, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [headlineSats, effectiveUnit, preferredFiatCurrency],
  );

  // Testnet line only appears next to a mainnet headline and only in native
  // (XNA) mode — testnet XNA has no real fiat value, so converting would be
  // misleading.
  const showTestnetLine =
    hasMainnet && hasTestnet && totalBalancePreferredUnit !== XnaUnit.LOCAL_CURRENCY;
  const testnetFormatted = useMemo(
    () =>
      showTestnetLine
        ? formatBalanceWithoutSuffix(testnetSats, totalBalancePreferredUnit, true)
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showTestnetLine, testnetSats, totalBalancePreferredUnit],
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
            hidden: headlineIsTestnet || totalBalancePreferredUnit === XnaUnit.LOCAL_CURRENCY,
          },
          { ...CommonToolTipActions.ViewInBitcoin, hidden: headlineIsTestnet || totalBalancePreferredUnit === XnaUnit.XNA },
        ],
      },
      CommonToolTipActions.CopyAmount,
      CommonToolTipActions.Hide,
    ],
    [preferredFiatCurrency, totalBalancePreferredUnit, headlineIsTestnet],
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
    // Headline shows testnet only — there is no meaningful fiat conversion, so
    // the tap toggle is a no-op rather than flipping to a misleading value.
    if (headlineIsTestnet) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // Neurai has a large coin supply, so SATS produces unwieldy numbers in the
    // total view. Toggle is XNA <-> fiat only; if a previous build stored SATS,
    // normalise to XNA.
    const nextUnit = totalBalancePreferredUnit === XnaUnit.XNA ? XnaUnit.LOCAL_CURRENCY : XnaUnit.XNA;
    await setTotalBalancePreferredUnitStorage(nextUnit);
  }, [headlineIsTestnet, totalBalancePreferredUnit, setTotalBalancePreferredUnitStorage]);

  if (!isTotalBalanceEnabled) return null;

  return (
    <ToolTipMenu actions={toolTipActions} onPressMenuItem={onPressMenuItem} shouldOpenOnLongPress style={styles.menuContainer}>
      <View style={styles.container}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{loc.wallets.total_balance}</Text>
          {headlineIsTestnet && <Text style={[styles.badge, { color: colors.foregroundColor }]}>TESTNET</Text>}
        </View>
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
        {showTestnetLine && (
          <Text style={[styles.testnetLine, { color: colors.alternativeTextColor ?? '#9BA0A9' }]} numberOfLines={1}>
            {loc.wallets.neurai_network_testnet} · {String(testnetFormatted)} {totalBalancePreferredUnit}
          </Text>
        )}
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 14,
    color: '#9BA0A9',
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    overflow: 'hidden',
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
  testnetLine: {
    fontSize: 13,
    marginTop: 4,
  },
});

export default TotalWalletsBalance;
