/**
 * List of Neurai Assets (tokens) held by a wallet.
 *
 * Rendered inside `WalletTransactions` when the "Assets" tab is selected. Reads
 * the wallet's cached asset list synchronously for an instant first paint, then
 * refreshes from the engine on focus / pull-to-refresh (which may bootstrap the
 * engine — hence the loading spinner). Each row shows the asset name, a badge
 * with its type, and the held amount. Sending an asset is initiated from the
 * Send screen's "Send an asset" switch, so rows here are informational.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, InteractionManager, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { isDesktop } from '../blue_modules/environment';
import { formatAssetAmount, type NeuraiAssetType, type NeuraiHeldAsset } from '../blue_modules/neurai/assetUtils';
import { isNeuraiWallet } from '../class/wallets/is-neurai-wallet';
import useWalletSubscribe from '../hooks/useWalletSubscribe';
import loc from '../loc';
import { useTheme } from './themes';

interface AssetsListProps {
  walletID: string;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
}

const typeLabel = (type: NeuraiAssetType): string => {
  switch (type) {
    case 'sub':
      return loc.assets.type_sub;
    case 'unique':
      return loc.assets.type_unique;
    case 'owner':
      return loc.assets.type_owner;
    case 'restricted':
      return loc.assets.type_restricted;
    case 'qualifier':
      return loc.assets.type_qualifier;
    case 'depin':
      return loc.assets.type_depin;
    default:
      return loc.assets.type_root;
  }
};

const AssetsList: React.FC<AssetsListProps> = ({ walletID, ListHeaderComponent }) => {
  const { colors } = useTheme();
  const wallet = useWalletSubscribe(walletID);
  const neurai = isNeuraiWallet(wallet) ? wallet : null;
  const assets = neurai ? neurai.getHeldAssetsCached() : [];
  const [isLoading, setIsLoading] = useState(false);

  const stylesHook = {
    root: { backgroundColor: colors.elevated },
    row: { borderBottomColor: colors.formBorder },
    name: { color: colors.foregroundColor },
    badge: { backgroundColor: colors.inputBackgroundColor, borderColor: colors.formBorder },
    badgeText: { color: colors.alternativeTextColor },
    amount: { color: colors.foregroundColor },
    empty: { color: colors.alternativeTextColor },
  };

  const refresh = useCallback(async () => {
    if (!neurai) return;
    setIsLoading(true);
    try {
      await neurai.refreshHeldAssets();
    } catch (err) {
      console.debug('AssetsList: refreshHeldAssets failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [neurai]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        refresh();
      });
      return () => task.cancel();
    }, [refresh]),
  );

  const renderItem = useCallback(
    // eslint-disable-next-line react/no-unused-prop-types
    ({ item }: { item: NeuraiHeldAsset }) => (
      <View style={[styles.row, stylesHook.row]}>
        <View style={styles.rowLeft}>
          <Text style={[styles.name, stylesHook.name]} numberOfLines={1} ellipsizeMode="middle">
            {item.name}
          </Text>
          <View style={[styles.badge, stylesHook.badge]}>
            <Text style={[styles.badgeText, stylesHook.badgeText]}>{typeLabel(item.type)}</Text>
          </View>
        </View>
        <Text style={[styles.amount, stylesHook.amount]} numberOfLines={1}>
          {formatAssetAmount(item.amount)}
        </Text>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors],
  );

  const keyExtractor = useCallback((item: NeuraiHeldAsset) => item.name, []);

  return (
    <FlatList<NeuraiHeldAsset>
      data={assets}
      extraData={[isLoading, assets.length]}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={stylesHook.root}
      ListHeaderComponent={ListHeaderComponent ?? undefined}
      contentInset={{ top: 0, left: 0, bottom: 90, right: 0 }}
      ListEmptyComponent={
        <ScrollView style={[styles.emptyContainer, stylesHook.root]} contentContainerStyle={styles.emptyContent}>
          {isLoading ? (
            <ActivityIndicator />
          ) : (
            <Text numberOfLines={0} style={[styles.emptyText, stylesHook.empty]} testID="AssetsListEmpty">
              {loc.assets.list_empty}
            </Text>
          )}
        </ScrollView>
      }
      refreshControl={
        !isDesktop ? <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.msSuccessCheck} /> : undefined
      }
    />
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  badge: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    height: '10%',
    minHeight: '10%',
    flex: 1,
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 200,
  },
  emptyText: {
    fontSize: 18,
    textAlign: 'center',
    marginVertical: 16,
  },
});

export default AssetsList;
