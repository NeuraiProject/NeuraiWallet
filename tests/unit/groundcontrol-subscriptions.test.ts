// GroundControl loses every push subscription when its database is wiped. The
// app re-sends its addresses when the server's `instance_id` changes, and
// otherwise only sends addresses it has not registered yet.

import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';

// Shared across `jest.resetModules()`, so a fresh module load behaves like an
// app restart with the same device storage.
const mockStore = new Map<string, string>();
const mockFetch = jest.fn();
const mockHandlers: { registered?: (event: { deviceToken: string }) => Promise<void> } = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('../../util/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));

jest.mock('react-native-permissions', () => ({
  checkNotifications: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestNotifications: jest.fn(() => Promise.resolve({ status: 'granted' })),
  RESULTS: { GRANTED: 'granted' },
}));

jest.mock('react-native-device-info', () => ({
  getApplicationName: jest.fn(() => 'NeuraiWallet'),
  getSystemName: jest.fn(() => 'Android'),
  getSystemVersion: jest.fn(() => '14'),
  getVersion: jest.fn(() => '1.0.0'),
  hasGmsSync: jest.fn(() => true),
  hasHmsSync: jest.fn(() => false),
}));

jest.mock('react-native-notifications', () => {
  const subscription = () => ({ remove: jest.fn() });
  const events = {
    registerRemoteNotificationsRegistered: jest.fn(callback => {
      mockHandlers.registered = callback;
      return subscription();
    }),
    registerRemoteNotificationsRegistrationFailed: jest.fn(subscription),
    registerRemoteNotificationsRegistrationDenied: jest.fn(subscription),
    registerNotificationReceivedForeground: jest.fn(subscription),
    registerNotificationReceivedBackground: jest.fn(subscription),
    registerNotificationOpened: jest.fn(subscription),
  };
  return {
    Notifications: {
      events: () => events,
      // FCM hands out the device token asynchronously, as on a real start.
      registerRemoteNotifications: jest.fn(() => setTimeout(() => mockHandlers.registered?.({ deviceToken: 'device-token' }), 0)),
      getInitialNotification: jest.fn(() => Promise.resolve(undefined)),
      setNotificationChannel: jest.fn(),
      ios: { setBadgeCount: jest.fn() },
    },
    NotificationBackgroundFetchResult: { NO_DATA: 'noData' },
  };
});

type TNotifications = typeof import('../../blue_modules/notifications');

/** What the mocked GroundControl answers to /setTokenConfiguration (`undefined`: an older server, empty body). */
let serverInstanceId: string | undefined;

const subscribeCalls = () =>
  mockFetch.mock.calls
    .filter(([url]) => String(url).endsWith('/majorTomToGroundControl'))
    .map(([, init]) => {
      const body = JSON.parse(init.body);
      return { chain: body.chain, addresses: body.addresses };
    });

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

/** Loads the module as on app start and lets the push-token registration (and the sync it triggers) finish. */
async function startApp(): Promise<TNotifications> {
  jest.resetModules();
  let notifications!: TNotifications;
  jest.isolateModules(() => {
    notifications = require('../../blue_modules/notifications');
  });
  await notifications.initializeNotifications();
  await settle();
  return notifications;
}

const wallets = (mainnet: string[], testnet: string[]) => [
  { chain: 'mainnet' as const, addresses: mainnet },
  { chain: 'testnet' as const, addresses: testnet },
];

beforeEach(() => {
  mockStore.clear();
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url.endsWith('/setTokenConfiguration')) {
      const body = serverInstanceId ? JSON.stringify({ instance_id: serverInstanceId }) : '';
      return Promise.resolve({ ok: true, json: async () => JSON.parse(body) });
    }
    return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('') });
  });
  serverInstanceId = 'db-1';
});

describe('GroundControl subscription sync', () => {
  it('registers every wallet address once the server instance is known', async () => {
    const notifications = await startApp();
    await notifications.syncGroundControlSubscriptions(wallets(['N1', 'N2'], ['t1']));

    expect(subscribeCalls()).toEqual([
      { chain: 'mainnet', addresses: ['N1', 'N2'] },
      { chain: 'testnet', addresses: ['t1'] },
    ]);
  });

  it('also works when the wallets are known before the push token', async () => {
    jest.resetModules();
    let notifications!: TNotifications;
    jest.isolateModules(() => {
      notifications = require('../../blue_modules/notifications');
    });
    await notifications.syncGroundControlSubscriptions(wallets(['N1'], []));
    expect(subscribeCalls()).toEqual([]);

    await notifications.initializeNotifications();
    await settle();
    expect(subscribeCalls()).toEqual([{ chain: 'mainnet', addresses: ['N1'] }]);
  });

  it('sends nothing again for addresses already registered, only new ones', async () => {
    const notifications = await startApp();
    await notifications.syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    mockFetch.mockClear();

    await notifications.syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    expect(subscribeCalls()).toEqual([]);

    await notifications.syncGroundControlSubscriptions(wallets(['N1', 'N3'], ['t1']));
    expect(subscribeCalls()).toEqual([{ chain: 'mainnet', addresses: ['N3'] }]);
  });

  it('sends nothing on a restart against the same server database', async () => {
    await (await startApp()).syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    mockFetch.mockClear();

    const restarted = await startApp();
    await restarted.syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    expect(subscribeCalls()).toEqual([]);
  });

  it('re-sends everything after the server database was reset', async () => {
    await (await startApp()).syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    mockFetch.mockClear();

    serverInstanceId = 'db-2';
    const restarted = await startApp();
    await restarted.syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    expect(subscribeCalls()).toEqual([
      { chain: 'mainnet', addresses: ['N1'] },
      { chain: 'testnet', addresses: ['t1'] },
    ]);
  });

  it('keeps the old behaviour with servers that send no instance id', async () => {
    serverInstanceId = undefined;
    const notifications = await startApp();
    await notifications.syncGroundControlSubscriptions(wallets(['N1'], ['t1']));
    expect(subscribeCalls()).toEqual([]);
  });

  it('retries on the next sync when the server rejects the registration', async () => {
    const notifications = await startApp();
    mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, statusText: 'error' }));
    await expect(notifications.syncGroundControlSubscriptions(wallets(['N1'], []))).rejects.toThrow();

    await notifications.syncGroundControlSubscriptions(wallets(['N1'], []));
    expect(subscribeCalls()).toEqual([
      { chain: 'mainnet', addresses: ['N1'] },
      { chain: 'mainnet', addresses: ['N1'] },
    ]);
  });

  it('registers an unsubscribed address again if its wallet comes back', async () => {
    const notifications = await startApp();
    await notifications.syncGroundControlSubscriptions(wallets(['N1', 'N2'], []));
    await notifications.unsubscribe(['N2'], [], [], 'mainnet');
    await notifications.syncGroundControlSubscriptions(wallets(['N1'], []));
    mockFetch.mockClear();

    await notifications.syncGroundControlSubscriptions(wallets(['N1', 'N2'], []));
    expect(subscribeCalls()).toEqual([{ chain: 'mainnet', addresses: ['N2'] }]);
  });

  it('does nothing when the user opted out of notifications', async () => {
    const notifications = await startApp();
    mockStore.set(notifications.NOTIFICATIONS_NO_AND_DONT_ASK_FLAG, 'true');
    await notifications.syncGroundControlSubscriptions(wallets(['N1'], []));
    expect(subscribeCalls()).toEqual([]);
  });
});

describe('Neurai wallet addresses before the engine bootstraps', () => {
  it('come from the addresses the previous session subscribed to', () => {
    const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const wallet = NeuraiHDWallet.forNetwork('testnet', MNEMONIC);
    expect(wallet.getAllExternalAddresses()).toEqual([]);

    (wallet as unknown as { _addressStatus: Record<string, string> })._addressStatus = { tAddr1: 'status1', tAddr2: 'status2' };
    expect(wallet.getAllExternalAddresses()).toEqual(['tAddr1', 'tAddr2']);
  });
});
