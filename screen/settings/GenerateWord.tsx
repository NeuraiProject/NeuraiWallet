/**
 * BIP39 final-word completer.
 *
 * Neurai's HD derivation is plain BIP39 (legacy ECDSA wallets use the
 * standard English wordlist; PQ wallets use the same wordlist on the
 * post-quantum derivation tree). Given a partial mnemonic of 11/14/17/20/23
 * words, we sweep all 2048 English BIP39 words, append each candidate to
 * the seed, and surface the ones that pass `bip39.validateMnemonic` — i.e.
 * those whose appended bits produce a valid checksum.
 *
 * Pure JS, runs locally, no network calls. Useful when the user is reading
 * a seed from a steel plate, paper, or recovery card and can't make out
 * the last word.
 */
import React, { useCallback, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import bip39 from 'bip39';

import { BlueFormLabel, BlueText } from '../../BlueComponents';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20, BlueSpacing40 } from '../../components/BlueSpacing';
import { useTheme } from '../../components/themes';
import loc from '../../loc';

const VALID_PARTIAL_LENGTHS = new Set([11, 14, 17, 20, 23]);

const GenerateWord: React.FC = () => {
  const { colors } = useTheme();
  const [partial, setPartial] = useState('');
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stylesHook = {
    root: { backgroundColor: colors.elevated, flex: 1 },
    inputBox: { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
    input: { color: colors.foregroundColor },
    candidate: { color: colors.foregroundColor },
    chip: { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
  };

  const compute = useCallback(() => {
    Keyboard.dismiss();
    setCandidates(null);
    setError(null);

    const words = partial.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!VALID_PARTIAL_LENGTHS.has(words.length)) {
      setError(loc.formatString(loc.autofill_word.error_partial_length, { count: words.length }));
      return;
    }

    const wordlist = bip39.wordlists.english;
    const matches: string[] = [];
    for (const candidate of wordlist) {
      const mnemonic = [...words, candidate].join(' ');
      if (bip39.validateMnemonic(mnemonic, wordlist)) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      setError(loc.autofill_word.error_no_match);
    } else {
      setCandidates(matches);
    }
  }, [partial]);

  const pasteFromClipboard = useCallback(async () => {
    const text = (await Clipboard.getString()) ?? '';
    if (text) setPartial(text.trim());
  }, []);

  const copyWord = useCallback((word: string) => {
    Clipboard.setString(word);
    presentAlert({ message: loc._.clipboard });
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.scroll} style={stylesHook.root}>
      <BlueSpacing20 />
      <Text style={[styles.hint, stylesHook.candidate]}>{loc.autofill_word.description}</Text>

      <BlueSpacing20 />
      <BlueFormLabel>{loc.autofill_word.input_label}</BlueFormLabel>
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          testID="PartialMnemonicInput"
          value={partial}
          placeholder={loc.autofill_word.input_placeholder}
          placeholderTextColor="#81868e"
          multiline
          numberOfLines={4}
          onChangeText={setPartial}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, stylesHook.input]}
          underlineColorAndroid="transparent"
        />
      </View>

      <BlueSpacing20 />
      <View style={styles.row}>
        <Button title={loc.send.input_paste} onPress={pasteFromClipboard} />
      </View>

      <BlueSpacing20 />
      <Button testID="ComputeFinalWord" title={loc.autofill_word.button} onPress={compute} />

      {error && (
        <>
          <BlueSpacing20 />
          <BlueText>{error}</BlueText>
        </>
      )}

      {candidates && candidates.length > 0 && (
        <>
          <BlueSpacing40 />
          <BlueFormLabel>
            {loc.formatString(loc.autofill_word.result_count, { count: candidates.length })}
          </BlueFormLabel>
          <View style={styles.chipsRow}>
            {candidates.map(word => (
              <Text
                key={word}
                onPress={() => copyWord(word)}
                style={[styles.chip, stylesHook.chip, stylesHook.candidate]}
              >
                {word}
              </Text>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 20 },
  inputBox: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 96,
    marginVertical: 12,
  },
  input: { textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  hint: { fontSize: 13, opacity: 0.75 },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    fontSize: 14,
    overflow: 'hidden',
  },
});

export default GenerateWord;
