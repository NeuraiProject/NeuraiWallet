/**
 * Reading a relay URL apart, without `URL`.
 *
 * React Native's built-in `URL` only understands http and https: its `host`
 * getter is a regex anchored to `^https?://`, so for `wss://relay.neurai.org/v1`
 * it returns an empty string — and it does not throw, so a `try/catch` fallback
 * never fires. Two things were quietly wrong because of it:
 *
 * - The relay name disappeared from the messages the user reads ("connections
 *   on : open sessions…").
 * - Worse, `sameRelay` compared `wss:// + "" + path`, so two relays on
 *   different hosts looked identical. That is the check that decides whether a
 *   scanned code is allowed to move the wallet to another relay, so it must not
 *   depend on a URL parser that silently gives up.
 *
 * Node's `URL` is correct, so a test written against it would have passed while
 * the device failed. Hence no `URL` here at all.
 */

// scheme://[user@]host[:port][/path][?query][#fragment]
const RELAY_URL = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/?#]*)([^?#]*)(\?[^#]*)?/i;

export interface RelayUrlParts {
  /** Lowercase, without the colon: `wss`. */
  scheme: string;
  /** Lowercase host, with the port when there is one: `relay.neurai.org`, `10.0.2.2:8080`. */
  host: string;
  path: string;
  /** Including the leading `?`, with its case untouched: it can carry a project key. */
  query: string;
}

export function parseRelayUrl(url: string): RelayUrlParts | undefined {
  const match = RELAY_URL.exec((url ?? '').trim());
  if (!match || !match[2]) return undefined;
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase(), path: match[3] ?? '', query: match[4] ?? '' };
}

/** Host of a relay URL, for messages the user reads. Anything unparseable is shown as it came. */
export function relayHost(url: string): string {
  return parseRelayUrl(url)?.host ?? (url ?? '').trim();
}

/** Same relay endpoint, ignoring a trailing slash. The query counts: it can carry the project key. */
export function sameRelay(a: string, b: string): boolean {
  const key = (url: string): string => {
    const parts = parseRelayUrl(url);
    if (!parts) return (url ?? '').trim().toLowerCase();
    return `${parts.scheme}://${parts.host}${parts.path.replace(/\/$/, '')}${parts.query}`;
  };
  return key(a) === key(b);
}
