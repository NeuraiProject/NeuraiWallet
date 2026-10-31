/**
 * Coin control on the send screen: a switch that reveals a list of coins, one
 * checkbox row each with its amount and address, so the send spends only the
 * ticked ones. The screen uses one for the wallet's coins and another, apart,
 * for its silent payments.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';

import { satsToXna } from '../blue_modules/neurai/amounts';
import type { WalletCoin } from '../class/wallets/abstract-neurai-wallet';
import { useTheme } from './themes';

export const coinKey = (coin: WalletCoin) => `${coin.txid}:${coin.outputIndex}`;
export const sumSats = (coins: WalletCoin[]) => coins.reduce((sum, c) => sum + c.satoshis, 0n);

interface CoinControlProps {
  label: string;
  accent: string;
  /** Prefix of the switch's and the rows' test IDs. */
  testID: string;
  coins: WalletCoin[];
  isOn: boolean;
  onSwitch: (on: boolean) => void;
  selected: ReadonlySet<string>;
  onToggleCoin: (coin: WalletCoin) => void;
  isLoading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  emptyText?: string;
}

const CoinControl: React.FC<CoinControlProps> = ({
  label,
  accent,
  testID,
  coins,
  isOn,
  onSwitch,
  selected,
  onToggleCoin,
  isLoading = false,
  loadingText,
  disabled = false,
  emptyText,
}) => {
  const { colors } = useTheme();
  const trackColor = useMemo(() => ({ false: undefined, true: accent }), [accent]);
  const stylesHook = {
    label: { color: colors.foregroundColor },
    list: { borderLeftColor: accent },
    row: { borderBottomColor: colors.formBorder },
    meta: { color: colors.alternativeTextColor },
  };

  return (
    <>
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, stylesHook.label]}>{label}</Text>
        <Switch testID={`${testID}Switch`} value={isOn} onValueChange={onSwitch} trackColor={trackColor} disabled={disabled} />
      </View>
      {isOn && (
        <View style={[styles.list, stylesHook.list]}>
          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={accent} />
              <Text style={[styles.loadingText, stylesHook.meta]}>{loadingText}</Text>
            </View>
          ) : coins.length === 0 ? (
            <Text style={[styles.empty, stylesHook.meta]}>{emptyText}</Text>
          ) : (
            coins.map(coin => {
              const checked = selected.has(coinKey(coin));
              return (
                <Pressable
                  key={coinKey(coin)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  testID={`${testID}Coin-${coinKey(coin)}`}
                  onPress={() => onToggleCoin(coin)}
                  disabled={disabled}
                  style={[styles.row, stylesHook.row]}
                >
                  <MaterialIcons
                    name={checked ? 'check-box' : 'check-box-outline-blank'}
                    size={22}
                    color={checked ? accent : colors.alternativeTextColor}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.amount, stylesHook.label]}>{`${satsToXna(coin.satoshis)} XNA`}</Text>
                    <Text style={[styles.address, stylesHook.meta]} numberOfLines={1} ellipsizeMode="middle">
                      {coin.address}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 8,
  },
  switchLabel: { fontSize: 16, fontWeight: '600' },
  list: { marginHorizontal: 20, marginVertical: 12, borderLeftWidth: 3 },
  loading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  loadingText: { fontSize: 13, marginLeft: 12 },
  empty: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, marginLeft: 12 },
  amount: { fontSize: 16, fontWeight: '600' },
  address: { fontSize: 13, marginTop: 2 },
});

export default CoinControl;
