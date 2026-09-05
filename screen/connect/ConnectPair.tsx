/**
 * The waiting room of Neurai Connect.
 *
 * A scanned `nc:` code only carries a topic and a symmetric key: it says how
 * to listen, not what the site wants. The wallet subscribes to the pairing
 * topic and the site then publishes its `wc_sessionAuthenticate` or
 * `wc_sessionPropose` on it, so there is always a gap — usually well under a
 * second, but a gap — between scanning and knowing which approval screen to
 * show. This screen is that gap made visible.
 *
 * It shows the relay host while it waits, because the relay is the only third
 * party in the exchange and the user is entitled to know which one is carrying
 * it, and it gives up after 30 seconds rather than spinning forever: a QR code
 * whose page was closed, or a pairing whose 5 minute TTL had already elapsed,
 * produces exactly this silence.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Button from '../../components/Button';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import { onConnectIncoming, pairWithUri } from '../../blue_modules/neurai/connect/client';
import { getRelayUrl } from '../../blue_modules/neurai/connect/config';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import type { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { describeError, relayHost, screenForIncoming } from './logic';

type RouteProps = RouteProp<DetailViewStackParamList, 'ConnectPair'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'ConnectPair'>;

/** How long the site is given to publish its request before we call it a failure. */
const WAIT_FOR_REQUEST_MS = 30_000;

const ConnectPair: React.FC = () => {
  const { colors } = useTheme();
  const route = useRoute<RouteProps>();
  const navigation = useExtendedNavigation<NavigationProps>();
  const uri = route.params?.uri ?? '';
  const [failure, setFailure] = useState<string | undefined>();
  const host = relayHost(getRelayUrl());

  const stylesHook = {
    text: { color: colors.foregroundColor },
    dim: { color: colors.alternativeTextColor },
    failureBox: { backgroundColor: colors.redBG },
    failureText: { color: colors.redText },
  };

  useEffect(() => {
    if (!uri) {
      setFailure(loc.connect.pair_no_uri);
      return;
    }
    let answered = false;

    // Subscribe before pairing: the site may already be publishing, and an
    // event that arrives while `pair()` is still awaiting must not be missed.
    const unsubscribe = onConnectIncoming(item => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      navigation.replace(screenForIncoming(item.kind), { id: item.id });
    });

    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      setFailure(loc.connect.pair_timeout);
    }, WAIT_FOR_REQUEST_MS);

    pairWithUri(uri).catch((error: unknown) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      setFailure(loc.formatString(loc.connect.pair_failed, { error: describeError(error) }));
    });

    return () => {
      answered = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [uri, navigation]);

  const onClose = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content}>
      {failure ? (
        <>
          <View style={[styles.failureBox, stylesHook.failureBox]}>
            <Text style={[styles.failureText, stylesHook.failureText]}>{failure}</Text>
          </View>
          <Text style={[styles.hint, stylesHook.dim]}>{loc.connect.pair_retry_hint}</Text>
          <Button title={loc.connect.close} onPress={onClose} />
        </>
      ) : (
        <>
          <ActivityIndicator size="large" />
          <Text style={[styles.waiting, stylesHook.text]}>{loc.connect.pair_waiting}</Text>
          <Text style={[styles.hint, stylesHook.dim]}>{loc.formatString(loc.connect.pair_relay, { relay: host })}</Text>
        </>
      )}
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingVertical: 24, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  waiting: { fontSize: 17, fontWeight: '600', marginTop: 24, textAlign: 'center' },
  hint: { fontSize: 13, marginTop: 12, marginBottom: 24, textAlign: 'center' },
  failureBox: { borderRadius: 8, padding: 16, marginBottom: 8, alignSelf: 'stretch' },
  failureText: { fontSize: 15, fontWeight: '600' },
});

export default ConnectPair;
