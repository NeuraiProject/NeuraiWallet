/**
 * Diagnostic screen.
 *
 * Runs a small battery of checks:
 *   1. Offline: HD and PQ testnet address derivation against a known mnemonic.
 *   2. Online: WSS reachability against the testnet wallet-services backend
 *      (mainnet WSS is gated by `MAINNET_BACKEND_DISABLED` so we exercise the
 *      live one).
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
import { createDefaultWssBackend } from '../../blue_modules/neurai';

const KNOWN_MNEMONIC = 'result pact model attract result puzzle final boss private educate luggage era';

type StepStatus = 'pending' | 'running' | 'ok' | 'fail';
interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
}

const initialSteps: Step[] = [
  { label: 'HD testnet address derivation', status: 'pending' },
  { label: 'PQ testnet address derivation', status: 'pending' },
  { label: 'WSS reachability (testnet, legacy)', status: 'pending' },
  { label: 'WSS reachability (testnet, pq)', status: 'pending' },
  { label: 'WSS tip height (testnet, legacy)', status: 'pending' },
];

function symbolFor(status: StepStatus): string {
  switch (status) {
    case 'pending':
      return '·';
    case 'running':
      return '…';
    case 'ok':
      return '✓';
    case 'fail':
      return '✗';
  }
}

const SelfTest: React.FC = () => {
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const next: Step[] = initialSteps.map(s => ({ ...s }));
    setSteps(next);

    const update = (i: number, status: StepStatus, detail?: string) => {
      next[i] = { ...next[i], status, detail };
      setSteps([...next]);
    };

    const runStep = async (i: number, fn: () => Promise<string | void>) => {
      update(i, 'running');
      try {
        const detail = await fn();
        update(i, 'ok', detail || undefined);
      } catch (e: any) {
        update(i, 'fail', e?.message ?? String(e));
      }
    };

    await runStep(0, async () => {
      const hd = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const addr = await hd.getReceiveAddressAsync();
      if (!addr.startsWith('t')) throw new Error(`expected 't' prefix, got '${addr}'`);
      return addr;
    });

    await runStep(1, async () => {
      const pq = NeuraiPQWallet.forNetwork('testnet', KNOWN_MNEMONIC);
      const addr = await pq.getReceiveAddressAsync();
      if (!addr.startsWith('tnq1')) throw new Error(`expected 'tnq1' prefix, got '${addr}'`);
      return addr;
    });

    await runStep(2, async () => {
      const backend = createDefaultWssBackend('testnet', 'legacy');
      const ok = await backend.ping();
      if (!ok) throw new Error('ping returned false');
      return 'ok';
    });

    await runStep(3, async () => {
      const backend = createDefaultWssBackend('testnet', 'pq');
      const ok = await backend.ping();
      if (!ok) throw new Error('ping returned false');
      return 'ok';
    });

    await runStep(4, async () => {
      const backend = createDefaultWssBackend('testnet', 'legacy');
      const height = await backend.getTipHeight();
      if (!Number.isFinite(height) || height <= 0) throw new Error(`bad tip height: ${height}`);
      return `height ${height}`;
    });

    setRunning(false);
  }, []);

  return (
    <SettingsScrollView>
      <SettingsCard>
        <View style={styles.card}>
          <BlueText>Runs offline assertions and live WSS checks against testnet wallet-services.</BlueText>
          <BlueSpacing20 />
          {running ? <ActivityIndicator /> : <Button title={loc.settings.selfTest} onPress={run} />}
          <BlueSpacing20 />
          {steps.map((s, i) => (
            <View key={i} style={styles.row}>
              <BlueText>
                {symbolFor(s.status)} {s.label}
                {s.detail ? `  —  ${s.detail}` : ''}
              </BlueText>
            </View>
          ))}
        </View>
      </SettingsCard>
    </SettingsScrollView>
  );
};


const styles = StyleSheet.create({
  card: { padding: 16 },
  row: { paddingVertical: 4 },
});

export default SelfTest;
