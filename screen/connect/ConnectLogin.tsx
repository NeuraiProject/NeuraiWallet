/**
 * "Sign in with Neurai": the approval screen for `wc_sessionAuthenticate`.
 *
 * Everything this screen shows is required by spec/auth.md section 2.1, and
 * the reasons are worth keeping next to the code:
 *
 * - `domain` and `aud` in large type, plus the time of the request and the
 *   `statement`, because those four are the only facts that distinguish the
 *   login the user started from one an attacker started.
 * - The literal sentence "By approving, the browser that shows this QR code
 *   will be connected to your account". A relayed QR code (section 9) carries
 *   the *correct* domain, so no check the wallet can perform detects it; the
 *   only defence left is telling the user plainly what approving means.
 * - A warning when the requester's metadata origin is not the domain being
 *   signed. What gets signed is always the domain shown, never the metadata.
 * - No verification code, ever. Earlier drafts had a 4-digit one; it was
 *   withdrawn because it does not protect against a relayed QR code and it
 *   would suggest a guarantee that does not exist.
 * - The exact canonical text, before approving. The user signs a specific
 *   string, so the user is shown that specific string.
 *
 * The address choice (section 8) is the other half of the screen: a per-domain
 * identity that no two sites can correlate, or a real wallet address the site
 * can look up on chain. The site states a preference in `addressPolicy`, which
 * nobody can verify and which therefore only decides which option starts
 * selected.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { buildCacao, buildCacaoPayload, formatAuthMessage } from '@neuraiproject/neurai-connect-wallet';

import presentAlert, { AlertType } from '../../components/Alert';
import Button from '../../components/Button';
import {
  ConnectActions,
  ConnectCard,
  ConnectChoice,
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
import { networkForCaip2 } from '../../blue_modules/neurai/connect/config';
import { deriveDomainIdentity, recordDomainIdentity, type DomainIdentity } from '../../blue_modules/neurai/connect/identity';
import { useConnectApprovalGate } from '../../hooks/useConnectApprovalGate';
import { signConnectMessage } from '../../blue_modules/neurai/connect/signer';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import type { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import {
  CONNECT_EMPTY_FIELD,
  type ConnectAddressKind,
  type ConnectApprovalBlocker,
  defaultAddressKind,
  asConnectWallet,
  describeError,
  formatMoment,
  loginApproval,
  pickChain,
} from './logic';

type RouteProps = RouteProp<DetailViewStackParamList, 'ConnectLogin'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'ConnectLogin'>;

/** The sentence that explains why approval is not available. */
function blockerText(blocker: ConnectApprovalBlocker | undefined): string | undefined {
  switch (blocker) {
    case 'no_wallet':
      return loc.connect.blocked_no_wallet;
    case 'hardware':
      return loc.connect.blocked_hardware;
    case 'expired':
      return loc.connect.blocked_expired;
    case 'no_identity':
      return loc.connect.blocked_no_identity;
    default:
      return undefined;
  }
}

const ConnectLogin: React.FC = () => {
  const { colors } = useTheme();
  const route = useRoute<RouteProps>();
  const navigation = useExtendedNavigation<NavigationProps>();
  const { wallets } = useStorage();
  const id = route.params.id;

  const incoming = useMemo(() => peekIncoming(id), [id]);
  const event = incoming?.kind === 'auth' ? incoming.event : undefined;
  const payload = event?.payload;

  // The chain to sign on is the first Neurai chain the site accepts; anything
  // else it lists belongs to another network and this wallet cannot serve it.
  const chainId = useMemo(() => pickChain(payload?.chains, c => networkForCaip2(c) !== undefined), [payload?.chains]);
  const network = chainId ? networkForCaip2(chainId) : undefined;

  const candidates = useMemo(
    () => wallets.filter(isNeuraiWallet).filter(w => network !== undefined && w.getNeuraiNetwork() === network),
    [wallets, network],
  );
  const [walletID, setWalletID] = useState<string | undefined>();
  // Chosen by the user, or the first candidate that can actually sign: a
  // hardware wallet listed first must not start selected only to block approval.
  const wallet = useMemo(
    () => candidates.find(w => w.getID() === walletID) ?? candidates.find(w => w.type !== NeuraiHardwareWallet.type) ?? candidates[0],
    [candidates, walletID],
  );

  const { requireUnlock } = useConnectApprovalGate();
  const [identity, setIdentity] = useState<DomainIdentity | undefined>();
  const [walletAddress, setWalletAddress] = useState<string | undefined>();
  const [addressKind, setAddressKind] = useState<ConnectAddressKind | undefined>();
  const [resolving, setResolving] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!wallet || !payload) {
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    (async () => {
      // `deriveDomainIdentity` answers undefined for the wallets that have no
      // BIP44 account 101 to derive from (post-quantum, hardware); that is the
      // signal that the identity option cannot be offered at all.
      const derived = await deriveDomainIdentity(asConnectWallet(wallet), payload.domain).catch(() => undefined);
      const address = await wallet.getReceiveAddressAsync().catch(() => undefined);
      if (cancelled) return;
      setIdentity(derived);
      setWalletAddress(address);
      setAddressKind(current => current ?? defaultAddressKind(payload.addressPolicy, derived !== undefined));
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, payload]);

  const chosenAddress = addressKind === 'identity' ? identity?.address : walletAddress;

  const approval = loginApproval({
    hasWallet: wallet !== undefined,
    isHardwareWallet: wallet?.type === NeuraiHardwareWallet.type,
    addressKind: addressKind ?? 'identity',
    identityAvailable: identity !== undefined,
    address: chosenAddress,
    expired: event?.verify.expired,
  });

  // The exact string that will be signed. Built from the payload the same way
  // the backend will rebuild it, so what is shown is what is verified.
  const canonical = useMemo(() => {
    if (!payload || !chainId || !chosenAddress) return { text: '', error: undefined as string | undefined };
    try {
      return { text: formatAuthMessage(buildCacaoPayload(payload, chainId, chosenAddress)), error: undefined };
    } catch (error: unknown) {
      return { text: '', error: describeError(error) };
    }
  }, [payload, chainId, chosenAddress]);

  const onApprove = useCallback(async () => {
    if (!payload || !chainId || !chosenAddress || !wallet) return;
    // Producing a signature for a web site is the sensitive act, so the unlock
    // sits here and not on the navigation to this screen (see useConnectApprovalGate).
    if (!(await requireUnlock())) return;
    setBusy(true);
    try {
      const client = connectClient();
      if (!client) throw new Error(loc.connect.error_not_connected);
      const cacaoPayload = buildCacaoPayload(payload, chainId, chosenAddress);
      const signature = await signConnectMessage(asConnectWallet(wallet), chosenAddress, formatAuthMessage(cacaoPayload));
      await client.approveAuth(id, { cacaos: [buildCacao(cacaoPayload, { t: signature.type, s: signature.signature })] });
      // Only now is the identity really "used": recording it earlier would leave
      // one behind for a login the user rejected.
      if (identity && chosenAddress === identity.address) await recordDomainIdentity(identity);
      takeIncoming(id);
      presentAlert({ message: loc.formatString(loc.connect.login_approved, { domain: payload.domain }), type: AlertType.Toast });
      navigation.goBack();
    } catch (error: unknown) {
      presentAlert({ message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [payload, chainId, chosenAddress, wallet, id, navigation, requireUnlock, identity]);

  const onReject = useCallback(async () => {
    setBusy(true);
    try {
      await connectClient()?.rejectAuth(id);
      takeIncoming(id);
    } catch (error: unknown) {
      console.warn('[neurai-connect] rejectAuth failed', error);
    } finally {
      setBusy(false);
      navigation.goBack();
    }
  }, [id, navigation]);

  if (!event || !payload) {
    return (
      <SafeAreaScrollView contentContainerStyle={connectStyles.centered}>
        <Text style={[styles.gone, { color: colors.alternativeTextColor }]}>{loc.connect.request_gone}</Text>
        <Button title={loc.connect.close} onPress={navigation.goBack} />
      </SafeAreaScrollView>
    );
  }

  // Computed once: it is both the reason the button is disabled and the
  // sentence shown next to it, and those two must never disagree.
  const blocked = blockerText(approval.blocker);
  const networkLabel =
    network === 'testnet' ? loc.wallets.neurai_network_testnet : network === 'mainnet' ? loc.wallets.neurai_network_mainnet : undefined;

  return (
    <SafeAreaScrollView contentContainerStyle={connectStyles.content}>
      <ConnectHeader title={payload.domain} subtitle={payload.aud} badge={networkLabel} />

      <ConnectNotice tone="warn" text={loc.connect.login_browser_warning} testID="ConnectBrowserWarning" />
      {!event.verify.domainMatchesMetadata && (
        <ConnectNotice
          tone="danger"
          testID="ConnectDomainMismatch"
          text={loc.formatString(loc.connect.login_domain_mismatch, { url: event.requester.metadata.url, domain: payload.domain })}
        />
      )}
      {event.verify.expired && <ConnectNotice tone="danger" text={loc.connect.blocked_expired} />}

      <ConnectCard>
        <ConnectRow label={loc.connect.field_requested_by} value={`${event.requester.metadata.name} — ${event.requester.metadata.url}`} />
        <ConnectRow label={loc.connect.field_statement} value={payload.statement || CONNECT_EMPTY_FIELD} />
        <ConnectRow
          label={loc.connect.field_requested_at}
          value={loc.formatString(loc.connect.field_requested_line, { time: formatMoment(payload.iat), exp: formatMoment(payload.exp) })}
        />
      </ConnectCard>

      <ConnectSectionTitle title={loc.connect.login_sign_in_as} hint={loc.connect.login_sign_in_as_hint} />
      {resolving ? (
        <ActivityIndicator />
      ) : (
        <>
          <ConnectChoice
            selected={addressKind === 'identity'}
            disabled={identity === undefined}
            title={loc.connect.login_identity_title}
            description={identity ? loc.connect.login_identity_description : loc.connect.blocked_no_identity}
            detail={identity?.address}
            onPress={() => setAddressKind('identity')}
            testID="ConnectAddressOption-identity"
          />
          <ConnectChoice
            selected={addressKind === 'wallet'}
            disabled={walletAddress === undefined}
            title={loc.connect.login_wallet_title}
            description={loc.connect.login_wallet_description}
            detail={walletAddress}
            onPress={() => setAddressKind('wallet')}
            testID="ConnectAddressOption-wallet"
          />
        </>
      )}

      {candidates.length > 1 && (
        <>
          <ConnectSectionTitle title={loc.connect.login_from_wallet} />
          {candidates.map(candidate => {
            const hardware = candidate.type === NeuraiHardwareWallet.type;
            return (
              <ConnectChoice
                key={candidate.getID()}
                selected={candidate.getID() === wallet?.getID()}
                disabled={hardware}
                title={candidate.getLabel()}
                description={hardware ? loc.connect.login_wallet_cannot_sign : undefined}
                onPress={() => setWalletID(candidate.getID())}
              />
            );
          })}
        </>
      )}

      <ConnectSectionTitle title={loc.connect.login_exact_text} hint={loc.connect.details_exact_text_hint} />
      {canonical.error ? (
        <ConnectNotice tone="danger" text={canonical.error} />
      ) : (
        <ConnectMonospaceBlock text={canonical.text} testID="ConnectCanonicalMessage" />
      )}
      {blocked !== undefined && <ConnectNotice tone="danger" text={blocked} />}

      <ConnectActions
        primary={{
          title: loc.connect.login_approve,
          onPress: onApprove,
          disabled: !approval.canApprove || busy || canonical.error !== undefined,
          testID: 'ConnectLoginApprove',
        }}
        secondary={{ title: loc.connect.reject, onPress: onReject, disabled: busy, testID: 'ConnectLoginReject' }}
      />
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  gone: { fontSize: 15, textAlign: 'center', marginBottom: 20 },
});

export default ConnectLogin;
