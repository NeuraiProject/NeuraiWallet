/**
 * Release notes screen.
 *
 * Lists the changes made when forking NeuraiWallet into NeuraiWallet. The
 * upstream `release-notes.txt` is generated from `git log` by `postinstall`
 * and resets on every `npm install`, so we hard-code the adaptation summary
 * here and keep it under source control.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BlueCard } from '../../BlueComponents';
import { useTheme } from '../../components/themes';

const NEURAI_ADAPTATION_NOTES: string[] = [
  'Initial port of NeuraiWallet to Neurai (XNA).',
  'Native support for Neurai mainnet and testnet, with per-wallet network selection.',
  'Two wallet kinds available at creation time: Neurai Legacy (ECDSA, BIP44) and Neurai Post-Quantum (ML-DSA-44, AuthScript v1).',
  'Bech32m AuthScript receive addresses for PQ wallets (nq1… on mainnet, tnq1… on testnet).',
  'WSS wallet-service backend for balance, history, UTXO scan and broadcast, with the direct JSON-RPC backend kept as an explicit fallback.',
  'BIP21 deeplinks moved to the xna: scheme; sender/receiver QR flows updated accordingly.',
  'Amounts and fees expressed in XNA / sats with Neurai-native unit conversion (1 XNA = 1e8 sats).',
  'Default fee estimate keyed to the node\'s estimatesmartfee (6 blocks), with the library\'s 0.05 XNA/kB fallback honored.',
  'Block-explorer selection (Rebel XNA / Testnet Rebel) wired into the Settings; testnet wallets always route to the testnet explorer regardless of preference.',
  'Send screen rewritten around @neuraiproject/neurai-create-transaction + @neuraiproject/neurai-sign-transaction; PQ signing path verified end-to-end.',
  'Receive screen polls the Neurai backend every 5 seconds for incoming payments and switches to a success view as soon as funds land.',
  'Wallet list and transaction history auto-refresh every 10 seconds; pull-to-refresh remains for manual sync.',
  'Bitcoin / Lightning / Multisig / Watch-only / BIP47 flows removed; navigation, types and storage trimmed accordingly.',
  'Bundle ID and Android namespace changed to org.neurai.wallet; launcher icons regenerated from the Neurai logo.',
  'BlueElectrum, GroundControl push notifications, NeuraiWallet Bugsnag and Firebase Cloud Messaging dependencies removed.',
  'Hermes runtime polyfills added (Uint8Array.prototype.equals, Buffer.prototype.subarray) so the post-quantum signer works on React Native.',
  'Settings > Tools restored with two NeuraiWallet-native tools: raw transaction broadcaster and BIP39 final-word completer.',
];

const ReleaseNotes: React.FC = () => {
  const { colors } = useTheme();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustContentInsets
      style={{ backgroundColor: colors.elevated }}
    >
      <BlueCard>
        <Text style={[styles.heading, { color: colors.foregroundColor }]}>What's new in NeuraiWallet</Text>
        <View style={styles.list}>
          {NEURAI_ADAPTATION_NOTES.map((note, idx) => (
            <View key={idx} style={styles.row}>
              <Text style={[styles.bullet, { color: colors.foregroundColor }]}>•</Text>
              <Text style={[styles.body, { color: colors.foregroundColor }]}>{note}</Text>
            </View>
          ))}
        </View>
      </BlueCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  list: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  bullet: {
    width: 16,
    fontSize: 16,
    lineHeight: 20,
  },
  body: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});

export default ReleaseNotes;
