/**
 * Raw transaction broadcaster for Neurai.
 *
 * The user pastes a signed transaction hex, picks a network (testnet by
 * default), and we relay it through the default RPC backend
 * (`createDefaultRpcBackend`). On success we surface the txid the node
 * accepts; on failure we show the RPC error verbatim so users debugging
 * a build can see *why* the node rejected it.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import { createDefaultRpcBackend, NeuraiNetwork } from '../../blue_modules/neurai';
import { BlueFormLabel, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20, BlueSpacing40 } from '../../components/BlueSpacing';
import SegmentedControl from '../../components/SegmentedControl';
import { useTheme } from '../../components/themes';
import loc from '../../loc';

const NETWORK_OPTIONS: NeuraiNetwork[] = ['testnet', 'mainnet'];

const Broadcast: React.FC = () => {
  const { colors } = useTheme();
  const [rawHex, setRawHex] = useState('');
  const [network, setNetwork] = useState<NeuraiNetwork>('testnet');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [resultTxid, setResultTxid] = useState<string | null>(null);

  const stylesHook = {
    root: { backgroundColor: colors.elevated, flex: 1 },
    inputBox: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    input: { color: colors.foregroundColor },
    txidBox: { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
    txidText: { color: colors.foregroundColor },
  };

  const networkSegments = NETWORK_OPTIONS.map(n =>
    n === 'mainnet' ? loc.wallets.neurai_network_mainnet : loc.wallets.neurai_network_testnet,
  );
  const selectedIndex = NETWORK_OPTIONS.indexOf(network);

  const onBroadcast = useCallback(async () => {
    Keyboard.dismiss();
    const trimmed = rawHex.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(trimmed) || trimmed.length < 20) {
      presentAlert({ message: loc.send.details_no_signed_tx });
      return;
    }
    setIsBroadcasting(true);
    setResultTxid(null);
    try {
      const backend = createDefaultRpcBackend(network, 'legacy');
      const txid = await backend.broadcast(trimmed);
      setResultTxid(txid);
    } catch (err: any) {
      presentAlert({ message: err?.message ?? String(err) });
    } finally {
      setIsBroadcasting(false);
    }
  }, [rawHex, network]);

  const pasteFromClipboard = useCallback(async () => {
    const text = (await Clipboard.getString()) ?? '';
    if (text) setRawHex(text.trim());
  }, []);

  const copyTxid = useCallback(() => {
    if (!resultTxid) return;
    Clipboard.setString(resultTxid);
    presentAlert({ message: loc._.clipboard });
  }, [resultTxid]);

  return (
    <ScrollView contentContainerStyle={styles.scroll} style={stylesHook.root}>
      <BlueSpacing20 />
      <BlueFormLabel>{loc.wallets.neurai_network_label}</BlueFormLabel>
      <View style={styles.segmentRow}>
        <SegmentedControl
          values={networkSegments}
          selectedIndex={selectedIndex}
          onChange={idx => setNetwork(NETWORK_OPTIONS[idx])}
        />
      </View>

      <BlueFormLabel>{loc.send.create_tx_signed_label}</BlueFormLabel>
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          testID="TxHexInput"
          value={rawHex}
          placeholder={loc.send.create_this_is_hex}
          placeholderTextColor="#81868e"
          multiline
          numberOfLines={6}
          onChangeText={setRawHex}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isBroadcasting}
          style={[styles.input, stylesHook.input]}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueSpacing20 />
      <View style={styles.row}>
        <Button title={loc.send.input_paste} onPress={pasteFromClipboard} />
      </View>

      <BlueSpacing20 />
      {isBroadcasting ? (
        <ActivityIndicator />
      ) : (
        <Button testID="BroadcastButton" title={loc.send.broadcastButton} onPress={onBroadcast} />
      )}

      {resultTxid && (
        <>
          <BlueSpacing40 />
          <BlueFormLabel>{loc.transactions.txid}</BlueFormLabel>
          <View style={[styles.txidBox, stylesHook.txidBox]}>
            <BlueText selectable style={stylesHook.txidText}>
              {resultTxid}
            </BlueText>
          </View>
          <BlueSpacing20 />
          <Button title={loc.transactions.details_copy} onPress={copyTxid} />
        </>
      )}

      <BlueSpacing40 />
      <Text style={[styles.hint, stylesHook.txidText]}>
        {loc.formatString(loc.settings.network_broadcast_explanation, { network })}
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 20 },
  segmentRow: { marginVertical: 12 },
  inputBox: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 120,
    marginVertical: 12,
  },
  input: { textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  txidBox: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
    marginVertical: 8,
  },
  hint: { fontSize: 12, opacity: 0.6, marginTop: 8 },
});

export default Broadcast;
