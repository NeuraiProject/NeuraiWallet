// Reading a relay URL apart.
//
// React Native's own `URL` only matches `^https?://`, so `wss://relay.neurai.org/v1`
// gives an empty host and no exception. Node's `URL` is correct, which is why the
// previous version of this code passed its tests and still failed on the phone:
// these cases are written against the parser, which uses no `URL` at all.

import { parseRelayUrl, relayHost, sameRelay } from '../../blue_modules/neurai/connect/relay-url';

describe('parseRelayUrl', () => {
  it('reads scheme, host, path and query of a ws or wss URL', () => {
    expect(parseRelayUrl('wss://relay.neurai.org/v1')).toEqual({
      scheme: 'wss',
      host: 'relay.neurai.org',
      path: '/v1',
      query: '',
    });
    expect(parseRelayUrl('ws://10.0.2.2:8080/v1?projectId=AbC')).toEqual({
      scheme: 'ws',
      host: '10.0.2.2:8080',
      path: '/v1',
      query: '?projectId=AbC', // the key keeps its case: it is compared, not displayed
    });
  });

  it('lowercases the scheme and the host, and copes with no path', () => {
    expect(parseRelayUrl('WSS://Relay.Neurai.ORG')).toEqual({ scheme: 'wss', host: 'relay.neurai.org', path: '', query: '' });
  });

  it('gives up on what is not a URL rather than inventing parts', () => {
    expect(parseRelayUrl('not a url')).toBeUndefined();
    expect(parseRelayUrl('wss://')).toBeUndefined();
    expect(parseRelayUrl('')).toBeUndefined();
  });
});

describe('relayHost', () => {
  it('is the host with its port, and shows anything else unchanged', () => {
    expect(relayHost('wss://relay.neurai.org/v1')).toBe('relay.neurai.org');
    expect(relayHost('ws://10.0.2.2:8080/v1')).toBe('10.0.2.2:8080');
    expect(relayHost('not a url')).toBe('not a url');
  });
});

describe('sameRelay', () => {
  it('ignores a trailing slash and the case of the scheme and host', () => {
    expect(sameRelay('wss://relay.neurai.org/v1', 'wss://relay.neurai.org/v1/')).toBe(true);
    expect(sameRelay('WSS://Relay.Neurai.org/v1', 'wss://relay.neurai.org/v1')).toBe(true);
  });

  it('tells two relays apart — the check that guards moving the wallet', () => {
    // The case React Native's URL got wrong: same scheme and path, different host.
    expect(sameRelay('wss://relay.neurai.org/v1', 'wss://staging.neurai.org/v1')).toBe(false);
    expect(sameRelay('ws://127.0.0.1:19030/v1', 'ws://localhost:19030/v1')).toBe(false);
    expect(sameRelay('wss://relay.neurai.org/v1', 'ws://relay.neurai.org/v1')).toBe(false);
    expect(sameRelay('wss://relay.neurai.org/v1', 'wss://relay.neurai.org/v2')).toBe(false);
  });

  it('counts the query string: it can carry the project key', () => {
    expect(sameRelay('wss://r.org/v1?projectId=a', 'wss://r.org/v1?projectId=b')).toBe(false);
    expect(sameRelay('wss://r.org/v1?projectId=a', 'wss://r.org/v1?projectId=a')).toBe(true);
  });
});
