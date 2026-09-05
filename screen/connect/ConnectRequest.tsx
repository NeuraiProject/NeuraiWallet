/**
 * Answering a `wc_sessionRequest` (spec/session.md section 3.4).
 *
 * One screen for four methods, because what changes between them is only how
 * much the user has to be shown before the wallet answers:
 *
 * - `getAccountAddresses` reveals addresses the session already exposed at
 *   settlement, so it is a confirmation and nothing more. Wallet addresses,
 *   never per-domain identities.
 * - `signMessage` shows the message in full. When the SDK's guard says the
 *   text is a sign-in message for a domain other than this session's, the
 *   screen offers no way to sign it at all: a site that could talk the user
 *   into signing one would obtain a login for that other domain. The guard is
 *   enforced in the SDK too (`respondRequest` refuses), so this screen is the
 *   explanation, not the defence.
 * - `sendTransfer` shows destination, amount and memo, as the specification
 *   requires, and then refuses with 4200: this wallet does not build
 *   transactions from a session yet. Showing before refusing is deliberate —
 *   the user should see what was asked for, not just that something was.
 * - `signPsbt` also answers 4200; decoding a PSBT, showing outputs, change and
 *   fee, and signing only our own inputs is a later version's work.
 *
 * The refusals are sent as soon as the screen opens rather than on a button,
 * so the dApp gets its answer instead of waiting out the request TTL.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import presentAlert, { AlertType } from '../../components/Alert';
import Button from '../../components/Button';
import {
  ConnectActions,
  ConnectCard,
  ConnectHeader,
  ConnectMonospaceBlock,
  ConnectNotice,
  ConnectRow,
  ConnectSectionTitle,
  connectStyles,
} from '../../components/ConnectParts';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import { connectClient, peekIncoming, takeIncoming } from '../../blue_modules/neurai/connect/client';
import { signConnectMessage } from '../../blue_modules/neurai/connect/signer';
import { useConnectApprovalGate } from '../../hooks/useConnectApprovalGate';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import type { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import {
  CONNECT_EMPTY_FIELD,
  CONNECT_USER_REJECTED,
  addressFromCaip10,
  asConnectWallet,
  describeError,
  methodHandling,
  signMessageText,
  summariseSendTransfer,
  unsupportedMethodError,
} from './logic';

type RouteProps = RouteProp<DetailViewStackParamList, 'ConnectRequest'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'ConnectRequest'>;

const ConnectRequest: React.FC = () => {
  const { colors } = useTheme();
  const route = useRoute<RouteProps>();
  const navigation = useExtendedNavigation<NavigationProps>();
  const { wallets } = useStorage();
  const id = route.params.id;

  const incoming = useMemo(() => peekIncoming(id), [id]);
  const event = incoming?.kind === 'request' ? incoming.event : undefined;
  const method = event?.method ?? '';
  const handling = methodHandling(method);

  // The account the session exposed at settlement is the one that answers: a
  // session request must never be served by an address the dApp never saw.
  const sessionAddress = addressFromCaip10(event?.session.namespaces.bip122?.accounts?.[0]);
  const wallet = useMemo(
    () => wallets.filter(isNeuraiWallet).find(w => sessionAddress !== undefined && w.weOwnAddress(sessionAddress)),
    [wallets, sessionAddress],
  );

  const { requireUnlock } = useConnectApprovalGate();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>();
  const answered = useRef(false);

  const finish = useCallback(() => {
    takeIncoming(id);
    navigation.goBack();
  }, [id, navigation]);

  // A method this version does not implement has nothing for the user to
  // decide, so its 4200 goes out as soon as the screen opens instead of making
  // the dApp wait out the request TTL for an answer that is already certain.
  // A *blocked* sign-in message is different: it is refused only when the user
  // presses Reject, so the screen never answers on their behalf in the one case
  // where the answer is about their own account.
  useEffect(() => {
    if (!event || answered.current || handling !== 'unsupported') return;
    answered.current = true;
    const error = unsupportedMethodError(method);
    setRefusal(error.message);
    connectClient()
      ?.rejectRequest(id, error)
      .then(() => takeIncoming(id))
      .catch((e: unknown) => console.warn('[neurai-connect] rejectRequest failed', e));
  }, [event, handling, method, id]);

  const onAnswerAddresses = useCallback(async () => {
    if (!sessionAddress) return;
    setBusy(true);
    try {
      const client = connectClient();
      if (!client) throw new Error(loc.connect.error_not_connected);
      await client.respondRequest(id, [{ address: sessionAddress }]);
      presentAlert({ message: loc.connect.request_addresses_sent, type: AlertType.Toast });
      finish();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [id, sessionAddress, finish]);

  const onSign = useCallback(async () => {
    if (!wallet || !sessionAddress || !event) return;
    // The unlock guards the signature itself: this screen can be reached with
    // `replace` or from a notification, neither of which passes through the
    // navigation-level biometrics list.
    if (!(await requireUnlock())) return;
    setBusy(true);
    try {
      const client = connectClient();
      if (!client) throw new Error(loc.connect.error_not_connected);
      const signature = await signConnectMessage(asConnectWallet(wallet), sessionAddress, signMessageText(event.params));
      await client.respondRequest(id, { signature: signature.signature });
      presentAlert({ message: loc.connect.request_signed, type: AlertType.Toast });
      finish();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [wallet, sessionAddress, event, id, finish, requireUnlock]);

  const onReject = useCallback(async () => {
    setBusy(true);
    try {
      if (!answered.current) {
        answered.current = true;
        // A blocked sign-in message is refused with the guard's own reason, so
        // the site is told what it did rather than just that it was refused.
        const guard = event?.guard;
        await connectClient()?.rejectRequest(
          id,
          guard?.blocked === true
            ? { code: CONNECT_USER_REJECTED, message: guard.reason ?? 'sign-in message for another domain' }
            : undefined,
        );
      }
    } catch (error: unknown) {
      console.warn('[neurai-connect] rejectRequest failed', error);
    } finally {
      setBusy(false);
      finish();
    }
  }, [event, id, finish]);

  if (!event) {
    return (
      <SafeAreaScrollView contentContainerStyle={connectStyles.centered}>
        <Text style={[styles.gone, { color: colors.alternativeTextColor }]}>{loc.connect.request_gone}</Text>
        <Button title={loc.connect.close} onPress={navigation.goBack} />
      </SafeAreaScrollView>
    );
  }

  const blocked = event.guard?.blocked === true;
  const transfer = method === 'sendTransfer' ? summariseSendTransfer(event.params) : undefined;
  const primaryAction =
    handling === 'answer'
      ? { title: loc.connect.request_addresses_confirm, onPress: onAnswerAddresses, disabled: busy || !sessionAddress }
      : handling === 'sign' && !blocked
        ? { title: loc.connect.request_sign, onPress: onSign, disabled: busy || !wallet, testID: 'ConnectRequestSign' }
        : undefined;

  return (
    <SafeAreaScrollView contentContainerStyle={connectStyles.content}>
      <ConnectHeader title={method} subtitle={`${event.session.peerMetadata.name} — ${event.session.peerMetadata.url}`} />

      {blocked && <ConnectNotice tone="danger" testID="ConnectSignMessageBlocked" text={loc.connect.request_signmessage_blocked} />}
      {handling === 'answer' && <ConnectNotice tone="info" text={loc.connect.request_addresses_explanation} />}
      {handling === 'sign' && !blocked && event.guard?.looksLikeLogin === true && (
        <ConnectNotice tone="warn" text={loc.connect.request_signmessage_login} />
      )}
      {handling === 'unsupported' && <ConnectNotice tone="warn" text={loc.formatString(loc.connect.request_unsupported, { method })} />}

      {handling === 'sign' && (
        <>
          <ConnectSectionTitle title={loc.connect.request_message} />
          <ConnectMonospaceBlock text={signMessageText(event.params)} testID="ConnectRequestMessage" />
          {!blocked && !wallet && <ConnectNotice tone="danger" text={loc.connect.blocked_no_wallet} />}
        </>
      )}

      <ConnectCard>
        {transfer && (
          <>
            <ConnectRow label={loc.connect.transfer_destination} value={transfer.destination} mono />
            <ConnectRow label={loc.connect.transfer_amount} value={transfer.amount} />
            <ConnectRow label={loc.connect.transfer_memo} value={transfer.memo} />
          </>
        )}
        <ConnectRow label={loc.connect.request_account} value={sessionAddress ?? CONNECT_EMPTY_FIELD} mono />
        <ConnectRow label={loc.connect.field_chain} value={event.chainId} mono />
        {refusal !== undefined && <ConnectRow label={loc.connect.request_answer_sent} value={refusal} />}
      </ConnectCard>

      <ConnectActions
        primary={primaryAction}
        secondary={{
          title: handling === 'unsupported' ? loc.connect.close : loc.connect.reject,
          onPress: onReject,
          disabled: busy,
          testID: 'ConnectRequestReject',
        }}
      />
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  gone: { fontSize: 15, textAlign: 'center', marginBottom: 20 },
});

export default ConnectRequest;
