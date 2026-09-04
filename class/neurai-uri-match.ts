/**
 * Recognition of the URIs the wallet accepts, from the QR scanner, a deep link
 * or the clipboard.
 *
 * Neurai owns three of them:
 *
 * - `nc:<topic>@1?relay=…&symKey=…` — a Neurai Connect pairing: a web site asking
 *   to log in or to open a session (spec/uri.md). `wc:<topic>@2?…` is accepted
 *   too, because the reference WalletConnect client produces it.
 * - `neuraiwallet://connect?uri=<nc:…>` — the same pairing arriving as a deep
 *   link, when the site and the wallet are on the same phone.
 * - `xna:<address>?amount=…` — a BIP21 payment request.
 *
 * The Bitcoin-era schemes (`bitcoin:`, `blue:`, `bluewallet:`) are still
 * accepted and handed to the legacy matcher, so links already in the wild keep
 * working; they are logged as deprecated and will be dropped in a later
 * release.
 */

import { isPairingUri, parsePairingUri } from '@neuraiproject/neurai-connect-core';
import DeeplinkSchemaMatch from './deeplink-schema-match';

/** A navigation target: the screen name and, when it needs them, its params. */
export type NeuraiUriRoute = [string, (Record<string, unknown> | undefined)?];

export interface NeuraiPaymentUri {
  address: string;
  amount?: string;
  label?: string;
  message?: string;
}

/**
 * Actions the caller supplies for URIs a `[screen, params]` route cannot express.
 */
export interface NeuraiUriHandlers {
  /**
   * Opens an `xna:` payment request. Sending needs a wallet to spend from, and
   * choosing one takes a callback that a route cannot carry, so the navigation
   * itself belongs to the caller (see `helpers/open-neurai-payment`).
   */
  onPayment?: (payment: NeuraiPaymentUri) => void;
}

const CONNECT_DEEP_LINK = 'neuraiwallet://connect';

/** True when the string is a Neurai Connect pairing, in either of its two forms. */
export function isConnectUri(value: string): boolean {
  const trimmed = (value ?? '').trim();
  if (trimmed.toLowerCase().startsWith(CONNECT_DEEP_LINK)) return true;
  return isPairingUri(trimmed);
}

/** Normalises a Connect pairing to its `nc:`/`wc:` form, or undefined when it is not one. */
export function connectUriFrom(value: string): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!isConnectUri(trimmed)) return undefined;
  if (!trimmed.toLowerCase().startsWith(CONNECT_DEEP_LINK)) return trimmed;
  try {
    const inner = new URL(trimmed).searchParams.get('uri');
    return inner && isPairingUri(inner) ? inner : undefined;
  } catch {
    return undefined;
  }
}

/** Parses `xna:<address>?amount=…`, or returns undefined when it is not a Neurai payment URI. */
export function parseNeuraiPaymentUri(value: string): NeuraiPaymentUri | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed.toLowerCase().startsWith('xna:')) return undefined;
  const withoutScheme = trimmed.slice(4).replace(/^\/\//, '');
  const [addressPart, queryPart] = withoutScheme.split('?', 2);
  if (!addressPart) return undefined;
  const result: NeuraiPaymentUri = { address: addressPart };
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [rawKey, rawValue] = pair.split('=', 2);
      if (!rawKey || rawValue === undefined) continue;
      const value_ = decodeURIComponent(rawValue);
      if (rawKey === 'amount') result.amount = value_;
      else if (rawKey === 'label') result.label = value_;
      else if (rawKey === 'message') result.message = value_;
    }
  }
  return result;
}

/** True for the Bitcoin-era schemes this fork still accepts as deprecated aliases. */
export function isLegacyScheme(value: string): boolean {
  return DeeplinkSchemaMatch.hasSchema(value);
}

const NeuraiUriMatch = {
  isConnectUri,
  connectUriFrom,
  parseNeuraiPaymentUri,
  isLegacyScheme,

  /**
   * Resolves a scanned or opened string to a navigation route.
   *
   * Neurai URIs are answered here; anything else is passed to the legacy
   * matcher, which handles Bitcoin-era links and bare addresses.
   */
  navigationRouteFor(
    event: { url: string },
    completionHandler: (route: NeuraiUriRoute) => void,
    context?: Parameters<typeof DeeplinkSchemaMatch.navigationRouteFor>[2],
    handlers?: NeuraiUriHandlers,
  ): void {
    const url = event?.url;
    if (typeof url !== 'string' || url.trim().length === 0) return;

    const connectUri = connectUriFrom(url);
    if (connectUri) {
      completionHandler(['ConnectPair', { uri: connectUri }]);
      return;
    }

    // It announces itself as ours but does not parse: say so at the scanner
    // instead of falling through and leaving the user staring at nothing.
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith('nc:') || trimmed.toLowerCase().startsWith(CONNECT_DEEP_LINK)) {
      // parsePairingUri carries the precise reason (bad version, bad key, no relay).
      parsePairingUri(
        trimmed.toLowerCase().startsWith(CONNECT_DEEP_LINK) ? (new URL(trimmed).searchParams.get('uri') ?? trimmed) : trimmed,
      );
      throw new Error('this Neurai Connect code is not valid');
    }

    // `xna:` is ours and the app registers the scheme, so it is answered here.
    // The send screen needs a wallet, which the `[screen, params]` completion
    // handler cannot choose, so the caller passes the action as `onPayment`.
    const payment = parseNeuraiPaymentUri(url);
    if (payment) {
      if (!handlers?.onPayment) throw new Error('this Neurai payment link cannot be opened from here');
      handlers.onPayment(payment);
      return;
    }
    // It says `xna:` but carries no address. Like a malformed `nc:`, it is ours
    // and it is broken, so it is reported rather than handed to a matcher that
    // does not know the scheme and would drop it without a word.
    if (trimmed.toLowerCase().startsWith('xna:')) throw new Error('this Neurai payment link is not valid');

    if (isLegacyScheme(url)) {
      console.warn('[neurai-uri] deprecated Bitcoin-era link opened the wallet:', url.split(':')[0]);
    }
    DeeplinkSchemaMatch.navigationRouteFor(event, completionHandler as never, context);
  },
};

export default NeuraiUriMatch;
