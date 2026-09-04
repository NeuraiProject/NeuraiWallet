// The bridge between the Neurai Connect SDK and the wallet's screens.
//
// The SDK delivers requests as events, but an approval screen is opened later
// and by id, so the bridge has to queue them and hand each one over exactly
// once. These tests pin that, and the "sessions changed" signal push
// registration hangs off — both are easy to break and invisible until a user
// scans a code and nothing opens.

import type { AuthRequestEvent, SessionRequestEvent } from '@neuraiproject/neurai-connect-wallet';

import {
  connectSessions,
  onConnectIncoming,
  onConnectNotice,
  onConnectSessionsChanged,
  peekIncoming,
  pendingIncoming,
  startConnect,
  takeIncoming,
} from '../../blue_modules/neurai/connect/client';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler[]>();
const fakeWallet = {
  on: (event: string, handler: Handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    return fakeWallet;
  },
  sessions: () => [{ topic: 'a'.repeat(64) }],
  close: jest.fn(async () => {}),
  resume: jest.fn(async () => {}),
};

jest.mock('@neuraiproject/neurai-connect-wallet', () => ({
  __esModule: true,
  NeuraiConnectWallet: { init: jest.fn(async () => fakeWallet) },
}));
jest.mock('react-native-secure-key-store', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async () => {}),
    get: jest.fn(async () => {
      throw new Error('empty');
    }),
    remove: jest.fn(async () => {}),
  },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
}));
jest.mock('react-native-default-preference', () => ({
  __esModule: true,
  default: {
    setName: jest.fn(async () => {}),
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    clear: jest.fn(async () => {}),
  },
}));

const fire = (event: string, payload: unknown) => (handlers.get(event) ?? []).forEach(h => h(payload));
const authEvent = (id: number) =>
  ({
    id,
    pairingTopic: 'p'.repeat(64),
    requester: { publicKey: 'k', metadata: { name: 'Site', url: 'https://example.com' } },
    payload: { domain: 'example.com' },
    verify: { domainMatchesMetadata: true, expired: false },
  }) as unknown as AuthRequestEvent;

beforeAll(async () => {
  await startConnect();
});

describe('incoming approvals', () => {
  it('queues an auth request and hands it over exactly once', () => {
    const seen: unknown[] = [];
    const off = onConnectIncoming(item => seen.push(item));
    fire('auth_request', authEvent(1));

    expect(seen).toHaveLength(1);
    expect(peekIncoming(1)).toMatchObject({ kind: 'auth', id: 1 });
    expect(peekIncoming(1)).toBeDefined(); // peeking does not consume
    expect(takeIncoming(1)).toMatchObject({ kind: 'auth' });
    expect(takeIncoming(1)).toBeUndefined(); // a screen cannot answer the same request twice
    off();
  });

  it('keeps several waiting, oldest first, and stops notifying after unsubscribe', () => {
    const seen: unknown[] = [];
    const off = onConnectIncoming(item => seen.push(item));
    fire('auth_request', authEvent(2));
    fire('session_request', {
      id: 3,
      topic: 't'.repeat(64),
      chainId: 'bip122:x',
      method: 'signMessage',
      params: {},
      session: {},
    } as unknown as SessionRequestEvent);
    expect(pendingIncoming().map(i => i.id)).toEqual([2, 3]);
    expect(pendingIncoming().map(i => i.kind)).toEqual(['auth', 'request']);

    off();
    fire('auth_request', authEvent(4));
    expect(seen.map((i: any) => i.id)).toEqual([2, 3]); // 4 was queued but not announced to us
    expect(peekIncoming(4)).toBeDefined();
    takeIncoming(2);
    takeIncoming(3);
    takeIncoming(4);
  });

  it('a listener that throws does not stop the others', () => {
    const seen: unknown[] = [];
    const offBad = onConnectIncoming(() => {
      throw new Error('boom');
    });
    const offGood = onConnectIncoming(item => seen.push(item));
    expect(() => fire('auth_request', authEvent(5))).not.toThrow();
    expect(seen).toHaveLength(1);
    offBad();
    offGood();
    takeIncoming(5);
  });
});

describe('notices and session changes', () => {
  it('reports what the SDK refused on our behalf', () => {
    const notices: unknown[] = [];
    const off = onConnectNotice(n => notices.push(n));
    fire('auth_rejected', { reason: 'the login request expired' });
    fire('request_blocked', { inspection: { reason: 'sign-in message for bank.example' } });
    expect(notices).toEqual([
      { kind: 'auth_rejected', message: 'the login request expired' },
      { kind: 'request_blocked', message: 'sign-in message for bank.example' },
    ]);
    off();
  });

  it('signals when the live sessions may have changed, carrying the topic that ended', () => {
    // Push registration follows this: a revoked session must stop waking the phone,
    // and the relay only removes a registration for the topic it is told about.
    const changes: { reason: string; topic?: string }[] = [];
    const off = onConnectSessionsChanged(change => changes.push(change));
    fire('session_settled', { session: { topic: 'a'.repeat(64) } });
    fire('session_delete', { topic: 'b'.repeat(64) });
    expect(changes).toEqual([
      { reason: 'settled', topic: 'a'.repeat(64) },
      { reason: 'deleted', topic: 'b'.repeat(64) },
    ]);
    off();
  });

  it('exposes the sessions the SDK holds', () => {
    expect(connectSessions()).toHaveLength(1);
  });
});
