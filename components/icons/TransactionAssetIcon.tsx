import React from 'react';
import { StyleSheet, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';

/**
 * Avatar for a Neurai asset (token) transaction in the transaction list.
 * A coloured ball mirroring `TransactionOutgoingIcon`/`TransactionIncomingIcon`,
 * red when the asset leaves the wallet and green when it arrives.
 */
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
  },
  ballSent: {
    backgroundColor: '#d0021b',
  },
  ballReceived: {
    backgroundColor: '#16a34a',
  },
});

const TransactionAssetIcon: React.FC<{ sent: boolean }> = ({ sent }) => (
  <View style={styles.box}>
    <View style={[styles.ball, sent ? styles.ballSent : styles.ballReceived]}>
      <MaterialIcons name="token" size={17} color="#ffffff" />
    </View>
  </View>
);

export default TransactionAssetIcon;
