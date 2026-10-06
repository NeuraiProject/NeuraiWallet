import React from 'react';
import { StyleSheet, View } from 'react-native';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';

import type { PrivacyTxKind } from '../../blue_modules/neurai/privacy/txTags';

/**
 * Avatar for a privacy pool transaction in the transaction list: a purple ball
 * with an arrow into the pool (deposit), out of it (withdrawal), or a generic
 * privacy mark for anything else (funding coins, transfers, fees).
 */
export const PRIVACY_COLOR = '#7c3aed';

const GLYPHS = {
  deposit: 'archive-arrow-down',
  withdraw: 'archive-arrow-up',
  other: 'incognito',
} as const;

const styles = StyleSheet.create({
  box: {
    position: 'relative',
  },
  ball: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PRIVACY_COLOR,
  },
});

const TransactionPrivacyIcon: React.FC<{ kind: PrivacyTxKind }> = ({ kind }) => (
  <View style={styles.box} testID={`TransactionPrivacyIcon-${kind}`}>
    <View style={styles.ball}>
      <MaterialDesignIcons name={GLYPHS[kind]} size={17} color="#ffffff" />
    </View>
  </View>
);

export default TransactionPrivacyIcon;
