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
 * - `signPsbt` decodes the transaction first (blue_modules/neurai/connect/psbt.ts):
 *   every output with its address and asset, what comes back to this wallet,
 *   what leaves it and the fee. A request that cannot be shown or must not be
 *   signed (foreign inputs, a sighash other than ALL, post-quantum inputs) is
 *   explained and can only be rejected. Legacy and ECDSA software wallets only.
 * - `neurai_getAccountXpub` shows what sharing the account key reveals before
 *   it is sent. Legacy and ECDSA software wallets only.
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
import {
  inspectSignPsbt,
  PSBT_ERROR_INVALID,
  PsbtRequestError,
  signPsbtWithWallet,
  type PsbtWallet,
} from '../../blue_modules/neurai/connect/psbt';
import type { ConnectAccountXpub } from '../../blue_modules/neurai/connect/xpub';
import { satsToXna } from '../../blue_modules/neurai/amounts';
import { useNeuraiHwDevice } from '../../blue_modules/neurai-hw/useNeuraiHwDevice';
import { useConnectApprovalGate } from '../../hooks/useConnectApprovalGate';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import type { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import {
  CONNECT_BASE_METHODS,
  CONNECT_EMPTY_FIELD,
  CONNECT_USER_REJECTED,
  CONNECT_XPUB_METHOD,
  addressFromCaip10,
  asConnectWallet,
  connectMethodsFor,
  describeError,
  describePsbtOutput,
  methodHandling,
  shorten,
  signMessageText,
  summariseSendTransfer,
  unsupportedMethodError,
} from './logic';

/** Every method a wallet of this version can answer; used while no wallet is resolved. */
const ALL_METHODS = [...CONNECT_BASE_METHODS, 'signPsbt', CONNECT_XPUB_METHOD];
const formatXna = (sats: bigint): string => satsToXna(sats);

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

  // The account the session exposed at settlement is the one that answers: a
  // session request must never be served by an address the dApp never saw.
  const sessionAddress = addressFromCaip10(event?.session.namespaces.bip122?.accounts?.[0]);
  const wallet = useMemo(
    () => wallets.filter(isNeuraiWallet).find(w => sessionAddress !== undefined && w.weOwnAddress(sessionAddress)),
    [wallets, sessionAddress],
  );

  // A hardware wallet signs on the device; the link is opened for the
  // signature and closed once the request is answered.
  const isHardware = wallet?.type === NeuraiHardwareWallet.type;
  const hw = useNeuraiHwDevice();

  // What this wallet implements decides the handling, whatever the session
  // settled: a post-quantum or hardware wallet refuses signPsbt with 4200.
  const supported = useMemo(
    () => (wallet ? connectMethodsFor({ walletKind: wallet.walletKind, isHardware }) : ALL_METHODS),
    [wallet, isHardware],
  );
  const handling = methodHandling(method, supported);
  const testnet = wallet?.getNeuraiNetwork() === 'testnet';

  const psbtWallet = useMemo<PsbtWallet | undefined>(
    () =>
      wallet
        ? {
            weOwnAddress: address => wallet.weOwnAddress(address),
            getMessageSigningMaterial: address => wallet.getMessageSigningMaterial(address),
          }
        : undefined,
    [wallet],
  );
  // Decoded once: what the screen shows is exactly what gets checked again and signed.
  const psbt = useMemo(() => {
    if (handling !== 'sign-psbt' || !event || !psbtWallet) return undefined;
    try {
      return { inspection: inspectSignPsbt(event.params, psbtWallet, testnet) };
    } catch (error: unknown) {
      return { error: error instanceof PsbtRequestError ? error : new PsbtRequestError(PSBT_ERROR_INVALID, describeError(error)) };
    }
  }, [handling, event, psbtWallet, testnet]);

  const [xpub, setXpub] = useState<ConnectAccountXpub | false | undefined>();
  useEffect(() => {
    if (handling !== 'share-xpub' || !wallet) return;
    let cancelled = false;
    wallet
      .getConnectAccountXpub()
      .then(value => !cancelled && setXpub(value))
      .catch(() => !cancelled && setXpub(false));
    return () => {
      cancelled = true;
    };
  }, [handling, wallet]);

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
      const signature = await signConnectMessage(asConnectWallet(wallet), sessionAddress, signMessageText(event.params), {
        connectDevice: isHardware ? hw.connect : undefined,
      });
      await client.respondRequest(id, { signature: signature.signature });
      presentAlert({ message: loc.connect.request_signed, type: AlertType.Toast });
      finish();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      if (isHardware) await hw.disconnect().catch(() => {});
      setBusy(false);
    }
  }, [wallet, sessionAddress, event, id, finish, requireUnlock, isHardware, hw]);

  const onSignPsbt = useCallback(async () => {
    if (!event || !psbtWallet || !psbt?.inspection) return;
    if (!(await requireUnlock())) return;
    setBusy(true);
    try {
      const client = connectClient();
      if (!client) throw new Error(loc.connect.error_not_connected);
      const signed = await signPsbtWithWallet(event.params, psbtWallet, testnet);
      answered.current = true;
      await client.respondRequest(id, { psbt: signed });
      presentAlert({ message: loc.connect.request_psbt_signed, type: AlertType.Toast });
      finish();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [event, psbtWallet, psbt, testnet, id, finish, requireUnlock]);

  const onShareXpub = useCallback(async () => {
    if (!xpub) return;
    // Not a signature, but it opens the whole account to the site: same unlock.
    if (!(await requireUnlock())) return;
    setBusy(true);
    try {
      const client = connectClient();
      if (!client) throw new Error(loc.connect.error_not_connected);
      answered.current = true;
      await client.respondRequest(id, xpub);
      presentAlert({ message: loc.connect.request_xpub_sent, type: AlertType.Toast });
      finish();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [xpub, id, finish, requireUnlock]);

  const onReject = useCallback(async () => {
    setBusy(true);
    try {
      if (!answered.current) {
        answered.current = true;
        // A blocked sign-in message is refused with the guard's own reason, so
        // the site is told what it did rather than just that it was refused;
        // a transaction that cannot be signed, with the reason it cannot.
        const guard = event?.guard;
        await connectClient()?.rejectRequest(
          id,
          guard?.blocked === true
            ? { code: CONNECT_USER_REJECTED, message: guard.reason ?? 'sign-in message for another domain' }
            : psbt?.error
              ? { code: psbt.error.code, message: psbt.error.message }
              : undefined,
        );
      }
    } catch (error: unknown) {
      console.warn('[neurai-connect] rejectRequest failed', error);
    } finally {
      setBusy(false);
      finish();
    }
  }, [event, psbt, id, finish]);

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
        : handling === 'sign-psbt' && psbt?.inspection
          ? { title: loc.connect.request_sign_transaction, onPress: onSignPsbt, disabled: busy, testID: 'ConnectRequestSignPsbt' }
          : handling === 'share-xpub' && xpub
            ? { title: loc.connect.request_xpub_share, onPress: onShareXpub, disabled: busy, testID: 'ConnectRequestShareXpub' }
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

      {handling === 'sign-psbt' && !wallet && <ConnectNotice tone="danger" text={loc.connect.blocked_no_wallet} />}
      {handling === 'sign-psbt' && psbt?.error && (
        <ConnectNotice
          tone="danger"
          testID="ConnectPsbtInvalid"
          text={loc.formatString(loc.connect.request_psbt_invalid, { reason: psbt.error.message })}
        />
      )}
      {handling === 'sign-psbt' && psbt?.inspection && (
        <>
          <ConnectNotice tone="info" text={loc.connect.request_psbt_explanation} />
          <ConnectSectionTitle title={loc.connect.request_psbt_outputs} />
          <ConnectCard testID="ConnectRequestPsbtOutputs">
            {psbt.inspection.outputs.map(output => (
              <ConnectRow
                key={output.index}
                label={
                  output.ownAddress
                    ? loc.connect.request_psbt_change
                    : String(loc.formatString(loc.connect.request_psbt_output, { index: output.index }))
                }
                value={describePsbtOutput(output, formatXna)}
                mono
              />
            ))}
          </ConnectCard>
          <ConnectCard>
            <ConnectRow label={loc.connect.request_psbt_spent} value={`${formatXna(psbt.inspection.spentSats)} XNA`} />
            <ConnectRow label={loc.connect.request_psbt_fee} value={`${formatXna(psbt.inspection.feeSats)} XNA`} />
            <ConnectRow
              label={loc.connect.request_psbt_inputs}
              value={`${psbt.inspection.toSign.length} / ${psbt.inspection.inputCount}`}
            />
          </ConnectCard>
        </>
      )}

      {handling === 'share-xpub' && (
        <>
          <ConnectNotice tone="warn" text={loc.connect.request_xpub_explanation} />
          {xpub === false && <ConnectNotice tone="danger" text={loc.connect.request_xpub_unavailable} />}
          {xpub && (
            <ConnectCard testID="ConnectRequestXpub">
              <ConnectRow label={loc.connect.request_xpub_path} value={xpub.path} mono />
              <ConnectRow label={loc.connect.request_xpub_type} value={xpub.addressType === 'ecdsa' ? 'ECDSA witness v3' : 'Legacy'} />
              <ConnectRow label={loc.connect.request_xpub_key} value={shorten(xpub.xpub, 14)} mono />
            </ConnectCard>
          )}
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
