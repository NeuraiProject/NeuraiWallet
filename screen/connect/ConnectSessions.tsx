/**
 * The Neurai Connect session manager.
 *
 * spec/session.md section 2 requires the wallet to offer exactly what this
 * screen offers: the list of sessions with their last activity, revocation of
 * a single session, a way to change relay, and "log out everywhere". A session
 * is standing permission granted to a web site, and permission the user cannot
 * see is permission the user cannot withdraw.
 *
 * It also lists the per-domain identities already used. They are not decoration:
 * their derivation indexes are sparse (spec/auth.md section 8.4), so a normal
 * BIP44 scan does not rediscover them after restoring from the 12 words. The
 * list is what makes them recoverable, which is why it is stored with the
 * wallets and why the screen says so out loud.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { Session, UsedIdentity } from '@neuraiproject/neurai-connect-wallet';

import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { ConnectNotice, ConnectRow, ConnectSectionTitle } from '../../components/ConnectParts';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import {
  changeRelay,
  connectPairings,
  connectSessions,
  RelayInUseError,
  relayHost,
  revokeAllSessions,
  revokeSession,
  startConnect,
} from '../../blue_modules/neurai/connect/client';
import { DEFAULT_RELAY_URL, getRelayUrl, getRelayUrlOverride } from '../../blue_modules/neurai/connect/config';
import { usedIdentities } from '../../blue_modules/neurai/connect/identity';
import loc from '../../loc';
import { CONNECT_EMPTY_FIELD, describeError, formatMoment, isValidRelayUrl } from './logic';

const ConnectSessions: React.FC = () => {
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [identities, setIdentities] = useState<UsedIdentity[]>([]);
  const [relay, setRelay] = useState<string>(getRelayUrl());
  const [busy, setBusy] = useState(false);
  // Sessions and pairings live on the relay in use, so while there are any the
  // relay cannot be changed (`changeRelay` refuses; this only says so) and
  // "log out everywhere" is the way out — including when the only thing left is
  // a pairing, which the session list above does not show.
  const [pairings, setPairings] = useState(0);

  const reload = useCallback(async () => {
    await startConnect().catch((error: unknown) => console.warn('[neurai-connect] start failed', error));
    setSessions(connectSessions());
    setIdentities(await usedIdentities().catch(() => []));
    setRelay(getRelayUrl());
    setPairings(connectPairings().length);
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    // Re-read on every focus rather than subscribing: a session can be settled
    // or revoked from any of the approval screens, and from the peer's side too.
    reload().catch((error: unknown) => console.warn('[neurai-connect] could not read the session list', error));
  }, [isFocused, reload]);

  /**
   * Changing relay drops the connection and every pending approval on it: the
   * topics we are subscribed to live on the old server, and half of a migration
   * is worse than none. `changeRelay` refuses outright while anything is still
   * there, so nothing is stranded on a relay the wallet no longer talks to.
   */
  const applyRelay = useCallback(
    async (url: string | null, shown: string) => {
      setBusy(true);
      try {
        await changeRelay(url);
        setRelay(shown);
      } catch (error: unknown) {
        presentAlert({
          message:
            error instanceof RelayInUseError
              ? loc.formatString(loc.connect.relay_locked, { relay: relayHost(getRelayUrl()) })
              : describeError(error),
        });
      } finally {
        setBusy(false);
        await reload();
      }
    },
    [reload],
  );

  const onSaveRelay = useCallback(async () => {
    const trimmed = relay.trim();
    if (!isValidRelayUrl(trimmed)) {
      presentAlert({ message: loc.connect.relay_invalid });
      return;
    }
    await applyRelay(trimmed === DEFAULT_RELAY_URL ? null : trimmed, trimmed);
  }, [relay, applyRelay]);

  const onResetRelay = useCallback(() => applyRelay(null, DEFAULT_RELAY_URL), [applyRelay]);

  const onRevoke = useCallback(
    async (topic: string) => {
      setBusy(true);
      try {
        await revokeSession(topic);
        await reload();
      } catch (error: unknown) {
        presentAlert({ message: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const onRevokeAll = useCallback(async () => {
    setBusy(true);
    try {
      await revokeAllSessions();
      await reload();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [reload]);

  // One rule for both buttons: what exists on this relay is what stops the move
  // and what "log out everywhere" clears.
  const hasConnections = sessions.length > 0 || pairings > 0;

  const stylesHook = {
    card: { backgroundColor: colors.elevated, borderColor: colors.formBorder },
    title: { color: colors.foregroundColor },
    subtitle: { color: colors.alternativeTextColor },
    inputBox: { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
    input: { color: colors.foregroundColor },
  };

  return (
    <SafeAreaScrollView contentContainerStyle={styles.content}>
      <ConnectSectionTitle title={loc.connect.sessions_title} />
      {sessions.length === 0 && <Text style={[styles.empty, stylesHook.subtitle]}>{loc.connect.sessions_empty}</Text>}
      {sessions.map(session => (
        <View key={session.topic} style={[styles.card, stylesHook.card]}>
          <Text style={[styles.cardTitle, stylesHook.title]}>{session.peerMetadata.name || CONNECT_EMPTY_FIELD}</Text>
          <Text style={[styles.cardSubtitle, stylesHook.subtitle]} selectable>
            {session.peerMetadata.url}
          </Text>
          <ConnectRow label={loc.connect.proposal_account} value={(session.namespaces.bip122?.accounts ?? []).join(', ')} mono />
          <ConnectRow label={loc.connect.sessions_last_activity} value={formatMoment(session.lastActivity)} />
          <ConnectRow label={loc.connect.sessions_expires} value={formatMoment(session.expiry * 1000)} />
          <Button title={loc.connect.sessions_revoke} disabled={busy} onPress={() => onRevoke(session.topic)} />
        </View>
      ))}

      {pairings > 0 && <ConnectNotice tone="info" text={loc.formatString(loc.connect.sessions_pairings, { count: pairings })} />}
      <BlueSpacing20 />
      <Button title={loc.connect.sessions_revoke_all} disabled={busy || !hasConnections} onPress={onRevokeAll} testID="ConnectRevokeAll" />

      <ConnectSectionTitle title={loc.connect.relay_title} />
      <View style={[styles.inputBox, stylesHook.inputBox]}>
        <TextInput
          value={relay}
          placeholder={DEFAULT_RELAY_URL}
          placeholderTextColor={colors.placeholderTextColor}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={setRelay}
          style={[styles.input, stylesHook.input]}
          testID="ConnectRelayInput"
          underlineColorAndroid="transparent"
        />
      </View>
      <Text style={[styles.hint, stylesHook.subtitle]}>{loc.connect.relay_hint}</Text>
      {hasConnections && (
        <ConnectNotice
          tone="warn"
          text={loc.formatString(loc.connect.relay_locked, { relay: relayHost(getRelayUrl()) })}
          testID="ConnectRelayLocked"
        />
      )}
      <Button title={loc.connect.relay_save} disabled={busy || hasConnections} onPress={onSaveRelay} testID="ConnectRelaySave" />
      <BlueSpacing20 />
      <Button
        title={loc.connect.relay_reset}
        disabled={busy || hasConnections || getRelayUrlOverride() === undefined}
        onPress={onResetRelay}
      />

      <ConnectSectionTitle title={loc.connect.identities_title} />
      <ConnectNotice tone="info" text={loc.connect.identities_backup_note} />
      {identities.length === 0 && <Text style={[styles.empty, stylesHook.subtitle]}>{loc.connect.identities_empty}</Text>}
      {identities.map(identity => (
        <View key={identity.domain} style={[styles.card, stylesHook.card]}>
          <Text style={[styles.cardTitle, stylesHook.title]}>{identity.domain}</Text>
          <Text style={[styles.mono, stylesHook.subtitle]} selectable>
            {identity.address}
          </Text>
          <ConnectRow label={loc.connect.identities_last_used} value={formatMoment(identity.lastUsedAt)} />
        </View>
      ))}
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12 },
  empty: { fontSize: 14, marginVertical: 8 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginVertical: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardSubtitle: { fontSize: 13, marginTop: 2, marginBottom: 4 },
  mono: { fontFamily: 'monospace', fontSize: 12, marginTop: 4 },
  inputBox: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 12 },
  input: { paddingVertical: 4 },
  hint: { fontSize: 12, marginBottom: 12 },
});

export default ConnectSessions;
