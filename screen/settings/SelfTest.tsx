/**
 * Diagnostic screen.
 *
 * The original NeuraiWallet self-test exercised every Bitcoin wallet class
 * (legacy, segwit, multisig, taproot, aezeed, slip39, payjoin, BIP38) plus
 * BlueElectrum end-to-end. None of that ships in NeuraiWallet, so this screen
 * is a placeholder while we decide which Neurai-side checks make sense
 * (e.g. RPC reachability, address derivation against the lib's known
 * vectors, mnemonic round-trip).
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BlueText } from '../../BlueComponents';
import Button from '../../components/Button';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { SettingsCard, SettingsScrollView } from '../../components/platform';
import loc from '../../loc';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';

const KNOWN_MNEMONIC = 'result pact model attract result puzzle final boss private educate luggage era';

type State = 'idle' | 'running' | 'ok' | 'fail';

const SelfTest: React.FC = () => {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setState('running');
    setError(null);
    try {
      // Legacy HD on testnet
      const hd = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const hdAddr = await hd.getReceiveAddressAsync();
      if (!hdAddr.startsWith('t')) throw new Error(`HD testnet address should start with 't', got '${hdAddr}'`);

      // PQ wallet on testnet
      const pq = NeuraiPQWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const pqAddr = await pq.getReceiveAddressAsync();
      if (!pqAddr.startsWith('tnq1')) throw new Error(`PQ testnet address should start with 'tnq1', got '${pqAddr}'`);

      setState('ok');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setState('fail');
    }
  }, []);

  return (
    <SettingsScrollView>
      <SettingsCard>
        <View style={styles.card}>
          <BlueText>Runs a small set of assertions against the Neurai libraries.</BlueText>
          <BlueSpacing20 />
          {state === 'running' ? <ActivityIndicator /> : <Button title={loc.settings.selfTest} onPress={run} />}
          <BlueSpacing20 />
          {state === 'ok' && <BlueText>OK</BlueText>}
          {state === 'fail' && <BlueText>FAIL: {error}</BlueText>}
        </View>
      </SettingsCard>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  card: { padding: 16 },
});

export default SelfTest;
