/**
 * Decision logic shared by the Neurai Connect screens.
 *
 * The screens are deliberately thin. Everything that decides *what* the user
 * is told and *whether* an approval may happen at all lives here, as pure
 * functions, for two reasons.
 *
 * The first is that these are exactly the decisions the protocol pins down:
 * which address signs a login and when the wallet may not sign at all
 * (spec/auth.md section 8), what a `sendTransfer` has to display before
 * anything is signed, and which methods this version answers instead of
 * refusing (spec/session.md section 3.4). Those deserve tests, and this
 * repository has no renderer wired up for these screens.
 *
 * The second is that a component that both renders and decides grows branches
 * no test ever reaches — and here the wrong branch means signing something the
 * user did not mean to sign.
 *
 * Nothing in this file imports React Native or the relay client, so it can be
 * exercised directly from `tests/unit/neurai-connect-screens.test.ts`.
 */

import type { SettledNamespaces } from '@neuraiproject/neurai-connect-wallet';
import type { AbstractNeuraiWallet } from '../../class/wallets/abstract-neurai-wallet';
import type { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import type { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import type { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';

/** The concrete wallets `isNeuraiWallet` narrows to. */
export type ConnectWallet = NeuraiHDWallet | NeuraiPQWallet | NeuraiHardwareWallet;

/**
 * The Connect integration layer (`signer.ts`, `identity.ts`) takes an
 * `AbstractNeuraiWallet`, but every concrete wallet class re-declares `type`
 * with its own string literal, so none of them is structurally assignable to
 * the abstract base: `'NeuraiHD'` is not `'abstract'`. The mismatch is in the
 * declaration, not in the values — the concrete wallets are exactly what those
 * functions expect — so the widening is done here, once, with a name that says
 * what it is, rather than sprinkling casts through the screens.
 */
export function asConnectWallet(wallet: ConnectWallet): AbstractNeuraiWallet {
  return wallet as unknown as AbstractNeuraiWallet;
}

/**
 * Placeholder for a field the request left empty. Not a localised string on
 * purpose: it is punctuation, and it must look the same in the summary the
 * user compares against what the web page shows.
 */
export const CONNECT_EMPTY_FIELD = '—';

/** Ticker shown when a transfer does not name an asset: the base currency. */
export const CONNECT_BASE_TICKER = 'XNA';

/** Error code 4200 of the Neurai bip122 profile: the method is not supported. */
export const CONNECT_UNSUPPORTED_METHOD = 4200;

/** Error code 4001: the user rejected the request. */
export const CONNECT_USER_REJECTED = 4001;

// ---------------------------------------------------------------------------
// Which address signs a login (spec/auth.md section 8)
// ---------------------------------------------------------------------------

export type ConnectAddressKind = 'identity' | 'wallet';

/**
 * `addressPolicy` as the wallet must read it. spec/auth.md section 2.1: the
 * field is absent by default and any value other than `"wallet"` or
 * `"identity"` must be treated as absent, which means `"identity"`. It is a
 * hint about the user interface, never a condition anyone can verify, so it
 * only decides which option starts selected.
 */
export function normalizeAddressPolicy(policy: unknown): ConnectAddressKind {
  return policy === 'wallet' ? 'wallet' : 'identity';
}

/**
 * The option the login screen starts on. The site's preference wins, except
 * when this wallet cannot derive a per-domain identity at all (post-quantum
 * and hardware wallets have no BIP44 account 101), in which case the only
 * thing it can sign with is a wallet address.
 */
export function defaultAddressKind(policy: unknown, identityAvailable: boolean): ConnectAddressKind {
  if (!identityAvailable) return 'wallet';
  return normalizeAddressPolicy(policy);
}

/** Why the login screen refuses to enable "Approve". Mapped to a sentence by the screen. */
export type ConnectApprovalBlocker =
  /** No wallet of the network the site asks for. */
  | 'no_wallet'
  /** Hardware wallet: the key never leaves the device, so nothing can be signed here yet. */
  | 'hardware'
  /** The request lapsed while the approval screen was open. */
  | 'expired'
  /** A per-domain identity was chosen but this wallet cannot derive one. */
  | 'no_identity'
  /** The address is still being derived. */
  | 'no_address';

export interface ConnectApproval {
  canApprove: boolean;
  blocker?: ConnectApprovalBlocker;
}

/**
 * Whether the login may be approved, and why not when it may not.
 *
 * The order of the checks is the order in which the reasons are worth
 * reporting: a missing wallet explains everything else, a hardware wallet
 * cannot be fixed by changing the address, an expired request must not be
 * signed even if everything else is in place (`approveAuth` re-checks the
 * window and throws), and only then do the per-choice reasons apply.
 */
export function loginApproval(input: {
  hasWallet: boolean;
  isHardwareWallet: boolean;
  addressKind: ConnectAddressKind;
  identityAvailable: boolean;
  address?: string;
  expired?: boolean;
}): ConnectApproval {
  if (!input.hasWallet) return { canApprove: false, blocker: 'no_wallet' };
  if (input.isHardwareWallet) return { canApprove: false, blocker: 'hardware' };
  if (input.expired) return { canApprove: false, blocker: 'expired' };
  if (input.addressKind === 'identity' && !input.identityAvailable) return { canApprove: false, blocker: 'no_identity' };
  if (!input.address) return { canApprove: false, blocker: 'no_address' };
  return { canApprove: true };
}

/**
 * The chain to sign on: the first one the site accepts that this wallet can
 * actually serve, falling back to the first of the list so the screen can
 * still show what was asked for and explain why it cannot answer it.
 */
export function pickChain(chains: string[] | undefined, isOurs: (chainId: string) => boolean): string | undefined {
  const list = chains ?? [];
  return list.find(isOurs) ?? list[0];
}

// ---------------------------------------------------------------------------
// Session proposals (spec/session.md section 3.3)
// ---------------------------------------------------------------------------

/** CAIP-10 account identifier. Always a **wallet** address, never an identity one. */
export function caip10Account(chainId: string, address: string): string {
  return `${chainId}:${address}`;
}

/**
 * The namespaces this wallet settles for a proposal. It grants exactly the
 * methods and events the dApp asked for — never more — on the single chain
 * the chosen wallet lives on, with one wallet account exposed.
 */
export function proposalNamespaces(
  asked: { methods?: string[]; events?: string[] } | undefined,
  chainId: string,
  walletAddress: string,
): SettledNamespaces {
  return {
    bip122: {
      chains: [chainId],
      accounts: [caip10Account(chainId, walletAddress)],
      methods: asked?.methods ?? [],
      events: asked?.events ?? [],
    },
  };
}

/** One entry of the `getAccountAddresses` result. `publicKey` and `path` are optional in the profile. */
export interface ConnectAddressEntry {
  address: string;
  publicKey?: string;
  path?: string;
}

/**
 * `sessionProperties.bip122_getAccountAddresses`: the answer to
 * `getAccountAddresses` handed over at settlement so the dApp does not have to
 * ask for it (spec/session.md section 3.3). Session properties are strings, so
 * the array travels as JSON.
 */
export function sessionProperties(entries: ConnectAddressEntry[]): Record<string, string> {
  return { bip122_getAccountAddresses: JSON.stringify(entries) };
}

// ---------------------------------------------------------------------------
// Session requests (spec/session.md section 3.4)
// ---------------------------------------------------------------------------

/** How this version of the wallet deals with a session method. */
export type ConnectMethodHandling =
  /** Answered from what the wallet already knows, with a confirmation and nothing to sign. */
  | 'answer'
  /** Needs a signature, so it needs the full message on screen and a PIN. */
  | 'sign'
  /** Refused with 4200: a later version will implement it. */
  | 'unsupported';

export function methodHandling(method: string): ConnectMethodHandling {
  if (method === 'getAccountAddresses') return 'answer';
  if (method === 'signMessage') return 'sign';
  return 'unsupported';
}

/**
 * The JSON-RPC error a method this wallet does not implement is answered with.
 * 4200 is "unsupported method" in the Neurai bip122 profile; the message names
 * the method so the site can tell the two pending cases apart in its logs.
 */
export function unsupportedMethodError(method: string): { code: number; message: string } {
  if (method === 'sendTransfer') return { code: CONNECT_UNSUPPORTED_METHOD, message: 'sendTransfer is not implemented yet' };
  if (method === 'signPsbt') return { code: CONNECT_UNSUPPORTED_METHOD, message: 'signPsbt is not implemented yet' };
  return { code: CONNECT_UNSUPPORTED_METHOD, message: `${method} is not supported by this wallet` };
}

/** The text of a `signMessage` request, whatever shape the site sent. */
export function signMessageText(params: unknown): string {
  const value = (params as { message?: unknown } | undefined)?.message;
  return typeof value === 'string' ? value : '';
}

export interface TransferSummary {
  destination: string;
  /** Amount and ticker, ready to print: the profile denominates the base currency in XNA. */
  amount: string;
  memo: string;
}

/**
 * What a `sendTransfer` shows before anything is signed (spec/session.md
 * section 3.4). Every field is rendered even when the site omitted it: a
 * transfer with no destination on screen is a transfer the user must be able
 * to see is malformed, not one that quietly hides a field.
 */
export function summariseSendTransfer(params: unknown): TransferSummary {
  const p = (params ?? {}) as { recipientAddress?: unknown; toAddress?: unknown; amount?: unknown; memo?: unknown; assetName?: unknown };
  const destination = typeof p.recipientAddress === 'string' ? p.recipientAddress : typeof p.toAddress === 'string' ? p.toAddress : '';
  const ticker = typeof p.assetName === 'string' && p.assetName.length > 0 ? p.assetName : CONNECT_BASE_TICKER;
  const amount = typeof p.amount === 'number' || (typeof p.amount === 'string' && p.amount.length > 0) ? `${p.amount} ${ticker}` : '';
  const memo = typeof p.memo === 'string' ? p.memo : '';
  return {
    destination: destination || CONNECT_EMPTY_FIELD,
    amount: amount || CONNECT_EMPTY_FIELD,
    memo: memo || CONNECT_EMPTY_FIELD,
  };
}

// ---------------------------------------------------------------------------
// Relay and formatting
// ---------------------------------------------------------------------------

/**
 * Host of the relay, for the pairing screen. The user is told which server the
 * wallet is talking to while it waits, because that is the only party that can
 * see the pairing happen at all.
 */
export { relayHost } from '../../blue_modules/neurai/connect/relay-url';

/** A relay URL the wallet accepts. Only the WebSocket schemes: the relay is not HTTP. */
export function isValidRelayUrl(url: string): boolean {
  return /^wss?:\/\/\S+$/i.test(url.trim());
}

/** Middle-ellipsis for addresses and topics, which are too long for one line. */
export function shorten(value: string, keep = 10): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/** A message out of anything that was thrown, for a screen that must say *something*. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** The approval screens, one per kind of thing a site can ask for. */
export type ConnectApprovalScreen = 'ConnectLogin' | 'ConnectProposal' | 'ConnectRequest';

/**
 * The screen that answers an incoming item. Both the pairing screen and the
 * background listener route with this, so a login can never end up on the
 * request screen depending on which of the two saw the event first.
 */
export function screenForIncoming(kind: 'auth' | 'proposal' | 'request'): ConnectApprovalScreen {
  if (kind === 'auth') return 'ConnectLogin';
  if (kind === 'proposal') return 'ConnectProposal';
  return 'ConnectRequest';
}

/**
 * A timestamp as the approval screens print it. Both RFC 3339 strings (what
 * the CAIP-122 payload carries) and unix milliseconds (what the SDK stamps on
 * an event) are accepted; anything unparsable prints as an empty field rather
 * than as "Invalid Date", because a date the wallet cannot read is a date the
 * user must not be asked to trust.
 */
export function formatMoment(value: string | number | undefined): string {
  if (value === undefined || value === '') return CONNECT_EMPTY_FIELD;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(ms)) return CONNECT_EMPTY_FIELD;
  return new Date(ms).toLocaleString();
}

/**
 * Whether a session proposal may be approved. A session only exposes an
 * account and a set of methods, so the single requirement is that there is a
 * wallet of the requested network with a resolved address to expose. Whether
 * that wallet can *sign* is decided later, per request, by the request screen:
 * a hardware wallet can legitimately hold a session that only ever answers
 * `getAccountAddresses`.
 */
export function sessionApproval(input: { hasWallet: boolean; address?: string }): ConnectApproval {
  if (!input.hasWallet) return { canApprove: false, blocker: 'no_wallet' };
  if (!input.address) return { canApprove: false, blocker: 'no_address' };
  return { canApprove: true };
}

/**
 * The address of a CAIP-10 account (`bip122:<reference>:<address>`). The
 * address is the last segment; splitting from the end keeps working if a
 * future namespace ever carries a colon of its own in the reference.
 */
export function addressFromCaip10(account: string | undefined): string | undefined {
  if (!account) return undefined;
  const address = account.slice(account.lastIndexOf(':') + 1);
  return address.length > 0 && address !== account ? address : undefined;
}
