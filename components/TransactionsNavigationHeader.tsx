import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import WalletGradient from '../class/wallet-gradient';
import { TWallet } from '../class/wallets/types';
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../loc';
import { XnaUnit } from '../models/xnaUnits';
import { FiatUnit } from '../models/fiatUnit';
import { BlurredBalanceView } from './BlurredBalanceView';
import { useSettings } from '../hooks/context/useSettings';
import ToolTipMenu from './TooltipMenu';
import useAnimateOnChange from '../hooks/useAnimateOnChange';
import { useLocale } from '@react-navigation/native';

interface TransactionsNavigationHeaderProps {
  wallet: TWallet;
  unit: XnaUnit;
  onWalletUnitChange: (unit: XnaUnit) => void;
  onManageFundsPressed?: (id?: string) => void;
  onWalletBalanceVisibilityChange?: (isShouldBeVisible: boolean) => void;
  unitSwitching?: boolean;
}

const TransactionsNavigationHeader: React.FC<TransactionsNavigationHeaderProps> = ({
  wallet,
  onWalletUnitChange,
  onManageFundsPressed,
  onWalletBalanceVisibilityChange,
  unit = XnaUnit.XNA,
  unitSwitching = false,
}) => {
  const { hideBalance } = wallet;
  const { preferredFiatCurrency } = useSettings();
  const { direction } = useLocale();
  const balanceOpacity = useSharedValue(1);
  const balanceTranslateY = useSharedValue(0);
  const previousBalance = useRef<string | undefined>(undefined);

  const handleCopyPress = useCallback(() => {
    const value = formatBalance(wallet.getBalance(), unit);
    if (value) {
      Clipboard.setString(value);
    }
  }, [unit, wallet]);

  const handleBalanceVisibility = useCallback(() => {
    onWalletBalanceVisibilityChange?.(!hideBalance);
  }, [onWalletBalanceVisibilityChange, hideBalance]);

  const changeWalletBalanceUnit = () => {
    let newWalletPreferredUnit = wallet.getPreferredBalanceUnit();

    console.debug('[UnitSwitch/UI] tap unit change', { walletID: wallet.getID?.(), current: newWalletPreferredUnit });

    if (newWalletPreferredUnit === XnaUnit.XNA) {
      newWalletPreferredUnit = XnaUnit.SATS;
    } else if (newWalletPreferredUnit === XnaUnit.SATS) {
      newWalletPreferredUnit = XnaUnit.LOCAL_CURRENCY;
    } else {
      newWalletPreferredUnit = XnaUnit.XNA;
    }

    console.debug('[UnitSwitch/UI] next unit resolved', { walletID: wallet.getID?.(), next: newWalletPreferredUnit });
    onWalletUnitChange(newWalletPreferredUnit);
  };

  // Manage-funds buttons (multisig "manage keys", LN refill) are gone with
  // their corresponding wallet types. The prop is preserved in the public API
  // for backwards compatibility with parent screens that still pass it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _unusedManageFunds = onManageFundsPressed;

  const onPressMenuItem = useCallback(
    (id: string) => {
      if (id === 'walletBalanceVisibility') {
        handleBalanceVisibility();
      } else if (id === 'copyToClipboard') {
        handleCopyPress();
      }
    },
    [handleBalanceVisibility, handleCopyPress],
  );

  const currentBalance = wallet ? wallet.getBalance() : 0;
  const formattedBalance = useMemo(() => {
    return unit === XnaUnit.LOCAL_CURRENCY
      ? formatBalance(currentBalance, unit, true)
      : formatBalanceWithoutSuffix(currentBalance, unit, true);
  }, [unit, currentBalance]);

  const balance = !wallet.hideBalance && formattedBalance;
  const safeBalance = balance ? String(balance) : undefined;

  useEffect(() => {
    if (hideBalance) {
      previousBalance.current = undefined;
      balanceOpacity.value = 1;
      balanceTranslateY.value = 0;
      return;
    }

    if (previousBalance.current !== undefined && previousBalance.current !== safeBalance) {
      balanceOpacity.value = 0;
      balanceTranslateY.value = 6;
      balanceOpacity.value = withTiming(1, { duration: 180 });
      balanceTranslateY.value = withSpring(0, { damping: 16, stiffness: 220 });
    }

    previousBalance.current = safeBalance;
  }, [safeBalance, hideBalance, balanceOpacity, balanceTranslateY]);

  const balanceAnimationKey = useMemo(
    () => `${wallet.getID?.() ?? ''}-${unit}-${hideBalance}-${safeBalance ?? ''}`,
    [safeBalance, hideBalance, unit, wallet],
  );
  const balanceAnimatedStyle = useAnimateOnChange(balanceAnimationKey);

  const animatedBalanceTextStyle = useAnimatedStyle(() => ({
    opacity: balanceOpacity.value,
    transform: [{ translateY: balanceTranslateY.value }],
  }));

  const toolTipWalletBalanceActions = useMemo(() => {
    return hideBalance
      ? [
          {
            id: 'walletBalanceVisibility',
            text: loc.transactions.details_balance_show,
            icon: {
              iconValue: 'eye',
            },
          },
        ]
      : [
          {
            id: 'walletBalanceVisibility',
            text: loc.transactions.details_balance_hide,
            icon: {
              iconValue: 'eye.slash',
            },
          },
          {
            id: 'copyToClipboard',
            text: loc.transactions.details_copy,
            icon: {
              iconValue: 'doc.on.doc',
            },
          },
        ];
  }, [hideBalance]);

  useEffect(() => {
    console.debug('[UnitSwitch/UI] render state', {
      walletID: wallet.getID?.(),
      unit,
      hideBalance,
      preferredFiat: preferredFiatCurrency?.endPointKey,
      switching: unitSwitching,
    });
  }, [wallet, unit, hideBalance, preferredFiatCurrency, unitSwitching]);

  const shapeImage = direction === 'rtl' ? require('../img/neurai-shape-rtl.png') : require('../img/neurai-shape.png');

  return (
    <LinearGradient colors={WalletGradient.gradientsFor(wallet.type)} style={styles.lineaderGradient}>
      <ImageBackground source={shapeImage} style={styles.shapeImage} />
      <View style={styles.contentContainer}>
        <Text testID="WalletLabel" numberOfLines={1} style={[styles.walletLabel, { writingDirection: direction }]}>
          {wallet.getLabel()}
        </Text>
        <Animated.View style={[styles.walletBalanceAndUnitContainer, balanceAnimatedStyle]}>
          <ToolTipMenu
            shouldOpenOnLongPress
            isButton
            enableAndroidRipple={false}
            buttonStyle={styles.walletBalance}
            onPressMenuItem={onPressMenuItem}
            actions={toolTipWalletBalanceActions}
          >
            <View style={styles.walletBalance}>
              {hideBalance ? (
                <BlurredBalanceView />
              ) : (
                <View key={`wallet-balance-textwrap-${wallet.getID?.() ?? ''}-${String(balance)}`}>
                  {(() => {
                    // Split into integer / decimal / suffix so the decimal
                    // portion can render smaller while the integer stays big.
                    const balanceText = String(balance);
                    const match = balanceText.match(/^([^.]*)(\.\d+)?(.*)$/);
                    const intPart = match?.[1] ?? balanceText;
                    // Wallet header: cap visible decimals at 4. Full precision
                    // is still available in the Send screen's "Available" hint.
                    const decRaw = match?.[2] ?? '';
                    const decPart = decRaw.length > 5 ? decRaw.slice(0, 5) : decRaw;
                    const suffix = match?.[3] ?? '';
                    return (
                      <Animated.Text
                        key={`wallet-balance-text-${wallet.getID?.() ?? ''}-${String(balance)}`} // force recreation on balance change for RTL correctness
                        testID="WalletBalance"
                        numberOfLines={1}
                        minimumFontScale={0.5}
                        adjustsFontSizeToFit
                        style={[styles.walletBalanceText, animatedBalanceTextStyle]}
                      >
                        {intPart}
                        {decPart ? <Text style={styles.walletBalanceDecimal}>{decPart}</Text> : null}
                        {suffix}
                      </Animated.Text>
                    );
                  })()}
                </View>
              )}
            </View>
          </ToolTipMenu>
          <TouchableOpacity style={styles.walletPreferredUnitView} onPress={changeWalletBalanceUnit} disabled={unitSwitching}>
            <Text style={styles.walletPreferredUnitText}>
              {unit === XnaUnit.LOCAL_CURRENCY ? (preferredFiatCurrency?.endPointKey ?? FiatUnit.USD) : unit}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  lineaderGradient: {
    minHeight: 140,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  // Faint Neurai mark behind the header content, matching the wallet card.
  shapeImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  contentContainer: {
    padding: 15,
  },
  walletLabel: {
    backgroundColor: 'transparent',
    fontSize: 19,
    color: '#fff',
    marginBottom: 10,
  },
  walletBalance: {
    flexShrink: 1,
    marginRight: 6,
  },
  walletBalanceAndUnitContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10, // Ensure there's some padding to the right
  },
  walletBalanceText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 36,
    flexShrink: 1, // Allow the text to shrink if there's not enough space
  },
  // Smaller font for the decimal portion so long balances like
  // 1045.892327832 fit in the header without aggressive font shrinking.
  walletBalanceDecimal: {
    fontSize: 22,
  },
  walletPreferredUnitView: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 8,
    minHeight: 35,
    minWidth: 65,
  },
  walletPreferredUnitText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export const actionKeys = {
  CopyToClipboard: 'copyToClipboard',
  WalletBalanceVisibility: 'walletBalanceVisibility',
  Refill: 'refill',
  RefillWithExternalWallet: 'refillWithExternalWallet',
};

export const actionIcons = {
  Eye: {
    iconValue: 'eye',
  },
  EyeSlash: {
    iconValue: 'eye.slash',
  },
  Clipboard: {
    iconValue: 'doc.on.doc',
  },
  Refill: {
    iconValue: 'goforward.plus',
  },
  RefillWithExternalWallet: {
    iconValue: 'qrcode',
  },
};

export default TransactionsNavigationHeader;
