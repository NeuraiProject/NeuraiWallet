import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from '../../components/Button';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import presentAlert from '../../components/Alert';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';
import { useNeuraiHwDevice } from '../../blue_modules/neurai-hw/useNeuraiHwDevice';

/**
 * Connect a NeuraiHW (ESP32) hardware wallet over USB and add it as a
 * watch-only wallet (Phase 2a). The diagnostic buttons (info / address / sign)
 * remain for troubleshooting the USB pipe.
 */
const NeuraiHwTest: React.FC = () => {
  const { colors } = useTheme();
  const { status, error, device, connect, disconnect } = useNeuraiHwDevice();
  const { addWallet, saveToDisk } = useStorage();
  const { navigate } = useExtendedNavigation();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>('');

  const stylesHook = {
    root: { backgroundColor: colors.elevated },
    output: { backgroundColor: colors.inputBackgroundColor, color: colors.foregroundColor },
    status: { color: colors.foregroundColor },
  };

  const append = useCallback((line: string) => {
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  }, []);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        const result = await fn();
        append(`✓ ${label}: ${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`);
      } catch (e: unknown) {
        append(`✗ ${label}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  const onConnect = useCallback(async () => {
    setBusy(true);
    append('Connecting…');
    const dev = await connect();
    setBusy(false);
    append(dev ? '✓ Connected' : `✗ Connect failed${error ? `: ${error}` : ''}`);
  }, [connect, error, append]);

  const onDisconnect = useCallback(async () => {
    await disconnect();
    append('Disconnected');
  }, [disconnect, append]);

  const onGetInfo = useCallback(() => run('info', () => device!.getInfo()), [run, device]);
  const onGetAddress = useCallback(() => run('get_address', () => device!.getAddress()), [run, device]);
  const onSignMessage = useCallback(
    () => run('sign_message', () => device!.signMessage('NeuraiWallet hardware wallet test')),
    [run, device],
  );

  const onCreateWallet = useCallback(async () => {
    if (!device) return;
    setBusy(true);
    append('Reading device for wallet creation…');
    try {
      const info = await device.getInfo();
      if ((info.key_type ?? 'legacy') !== 'pq') {
        throw new Error('Only PQ (post-quantum) devices are supported for now');
      }
      // Requires the user to confirm on the device; returns the PQ address,
      // pubkey, commitment, witnessScript and authType.
      const addr = await device.getAddress();
      const wallet = new NeuraiHardwareWallet();
      wallet.setFromDeviceInfo(info, addr);
      if (!wallet.address) throw new Error('Device did not return an address');
      addWallet(wallet);
      await saveToDisk();
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      append(`✓ Watch-only wallet created: ${wallet.address}`);
      navigate('WalletsList', undefined as never);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      append(`✗ create wallet: ${message}`);
      presentAlert({ message });
    } finally {
      setBusy(false);
    }
  }, [device, addWallet, saveToDisk, navigate, append]);

  const isConnected = status === 'connected' && device !== null;
  const isUnsupported = status === 'unsupported';

  return (
    <SafeAreaScrollView style={stylesHook.root}>
      <BlueSpacing20 />
      <View style={styles.section}>
        <Text style={[styles.statusText, stylesHook.status]}>
          Status: {status}
          {error ? ` — ${error}` : ''}
        </Text>
      </View>

      {isUnsupported ? (
        <View style={styles.section}>
          <Text style={stylesHook.status}>USB hardware wallet is only available on Android.</Text>
        </View>
      ) : (
        <View style={styles.section}>
          {!isConnected ? (
            <Button title="Connect device" onPress={onConnect} disabled={busy} />
          ) : (
            <>
              <Button title="Add watch-only wallet" onPress={onCreateWallet} disabled={busy} />
              <BlueSpacing20 />
              <Text style={[styles.hint, stylesHook.status]}>Diagnostics</Text>
              <BlueSpacing20 />
              <Button title="Get info" onPress={onGetInfo} disabled={busy} />
              <BlueSpacing20 />
              <Button title="Get address" onPress={onGetAddress} disabled={busy} />
              <BlueSpacing20 />
              <Button title="Sign test message" onPress={onSignMessage} disabled={busy} />
              <BlueSpacing20 />
              <Button title="Disconnect" onPress={onDisconnect} disabled={busy} />
            </>
          )}
        </View>
      )}

      {busy ? (
        <View style={styles.section}>
          <ActivityIndicator />
        </View>
      ) : null}

      <View style={styles.section}>
        <ScrollView style={[styles.output, stylesHook.output]} contentContainerStyle={styles.outputContent}>
          <Text style={[styles.outputText, stylesHook.output]} selectable>
            {log || 'No output yet.'}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 20,
    marginVertical: 8,
  },
  statusText: {
    fontWeight: '600',
  },
  hint: {
    textAlign: 'center',
    opacity: 0.6,
    fontSize: 12,
  },
  output: {
    minHeight: 200,
    maxHeight: 360,
    borderRadius: 6,
  },
  outputContent: {
    padding: 12,
  },
  outputText: {
    fontFamily: 'Courier',
    fontSize: 12,
  },
});

export default NeuraiHwTest;
