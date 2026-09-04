// Recognition of the URIs the wallet accepts.
//
// The scanner hands us whatever the camera read, so this is the first place a
// hostile string reaches: a Neurai Connect pairing must be validated here, and
// anything that is not ours must fall through to the legacy matcher untouched
// rather than being half-interpreted.

import NeuraiUriMatch, { connectUriFrom, isConnectUri, isLegacyScheme, parseNeuraiPaymentUri } from '../../class/neurai-uri-match';

const TOPIC = '118be38d7e608d90657282564ea1f4eb96d9dc5f23a902039a4d7eec2fc1c610';
const SYM_KEY = '2efa6e27dbf465a5f77ced7794fb0ca9d3aca9d761afb7ce6e28c801d7dec012';
const NC_URI = `nc:${TOPIC}@1?relay=wss%3A%2F%2Frelay.neurai.org%2Fv1&symKey=${SYM_KEY}`;
const WC_URI = `wc:${TOPIC}@2?relay-protocol=irn&symKey=${SYM_KEY}&expiryTimestamp=1788000000`;

describe('Neurai Connect pairings', () => {
  it('recognises nc:, wc: and the deep link wrapper', () => {
    expect(isConnectUri(NC_URI)).toBe(true);
    expect(isConnectUri(WC_URI)).toBe(true);
    expect(isConnectUri(`neuraiwallet://connect?uri=${encodeURIComponent(NC_URI)}`)).toBe(true);
    expect(isConnectUri('  ' + NC_URI + '  ')).toBe(true);
  });

  it('unwraps the deep link to the pairing it carries', () => {
    expect(connectUriFrom(`neuraiwallet://connect?uri=${encodeURIComponent(NC_URI)}`)).toBe(NC_URI);
    expect(connectUriFrom(NC_URI)).toBe(NC_URI);
    expect(connectUriFrom('neuraiwallet://connect')).toBeUndefined();
    expect(connectUriFrom('neuraiwallet://connect?uri=not-a-pairing')).toBeUndefined();
  });

  it('rejects what only looks like a pairing', () => {
    expect(isConnectUri('nc:short@1?symKey=' + SYM_KEY)).toBe(false);
    expect(isConnectUri(`nc:${TOPIC}@1?symKey=zz`)).toBe(false);
    expect(isConnectUri(`nc:${TOPIC}@1?symKey=${SYM_KEY}`)).toBe(false); // nc: needs an explicit relay
    expect(isConnectUri('xna:NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc')).toBe(false);
    expect(isConnectUri('')).toBe(false);
  });

  it('routes a pairing to the Connect screen with the normalised URI', () => {
    const routes: unknown[][] = [];
    NeuraiUriMatch.navigationRouteFor({ url: `neuraiwallet://connect?uri=${encodeURIComponent(NC_URI)}` }, (route: unknown[]) =>
      routes.push(route),
    );
    expect(routes).toEqual([['ConnectPair', { uri: NC_URI }]]);
  });

  it('fails loudly on a code that claims to be ours but is not valid', () => {
    // Unsupported version, missing relay, bad key: the scanner must tell the user,
    // not fall through in silence.
    expect(() => NeuraiUriMatch.navigationRouteFor({ url: `nc:${TOPIC}@9?relay=wss%3A%2F%2Fr&symKey=${SYM_KEY}` }, () => {})).toThrow();
    expect(() => NeuraiUriMatch.navigationRouteFor({ url: `nc:${TOPIC}@1?symKey=${SYM_KEY}` }, () => {})).toThrow(/relay/);
    expect(() => NeuraiUriMatch.navigationRouteFor({ url: 'neuraiwallet://connect?uri=not-a-pairing' }, () => {})).toThrow();
  });
});

describe('xna: payment requests', () => {
  it('parses the address and the optional fields', () => {
    expect(parseNeuraiPaymentUri('xna:NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc')).toEqual({ address: 'NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc' });
    expect(parseNeuraiPaymentUri('xna:NX7s?amount=1.5&label=Shop%20one&message=hi')).toEqual({
      address: 'NX7s',
      amount: '1.5',
      label: 'Shop one',
      message: 'hi',
    });
    expect(parseNeuraiPaymentUri('XNA://NX7s?amount=2')).toEqual({ address: 'NX7s', amount: '2' });
  });

  it('is undefined for anything else', () => {
    expect(parseNeuraiPaymentUri('bitcoin:1abc')).toBeUndefined();
    expect(parseNeuraiPaymentUri('NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc')).toBeUndefined();
    expect(parseNeuraiPaymentUri('xna:')).toBeUndefined();
  });
});

describe('inherited Bitcoin-era links', () => {
  it('still recognises them, so existing links keep opening the app', () => {
    expect(isLegacyScheme('bitcoin:1abc')).toBe(true);
    expect(isLegacyScheme('bluewallet:bitcoin:1abc')).toBe(true);
    expect(isLegacyScheme('xna:NX7s')).toBe(false);
  });

  it('routes a payment request to the handler the caller supplies', () => {
    const routes: unknown[][] = [];
    const payments: unknown[] = [];
    NeuraiUriMatch.navigationRouteFor(
      { url: 'xna:NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc?amount=2.5' },
      (route: unknown[]) => routes.push(route),
      undefined,
      { onPayment: payment => payments.push(payment) },
    );
    expect(payments).toEqual([{ address: 'NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc', amount: '2.5' }]);
    expect(routes).toEqual([]); // the send screen is opened by the caller, not by a route
  });

  it('says so instead of silently dropping the link when no handler was given', () => {
    expect(() => NeuraiUriMatch.navigationRouteFor({ url: 'xna:NX7s' }, () => undefined)).toThrow(/cannot be opened/);
  });

  it('reports an xna: link with no address instead of dropping it silently', () => {
    const routes: unknown[][] = [];
    const payments: unknown[] = [];
    const route = (url: string) =>
      NeuraiUriMatch.navigationRouteFor({ url }, (r: unknown[]) => routes.push(r), undefined, { onPayment: p => payments.push(p) });

    expect(() => route('xna:')).toThrow(/not valid/);
    expect(() => route('xna:?amount=1')).toThrow(/not valid/);
    expect(routes).toEqual([]);
    expect(payments).toEqual([]);
  });

  it('hands anything that is not ours to the legacy matcher', () => {
    const routes: unknown[][] = [];
    // A bare string the legacy matcher does not understand either: nothing is routed,
    // and nothing throws.
    expect(() => NeuraiUriMatch.navigationRouteFor({ url: 'hello world' }, (route: unknown[]) => routes.push(route))).not.toThrow();
    expect(routes).toEqual([]);
  });
});
