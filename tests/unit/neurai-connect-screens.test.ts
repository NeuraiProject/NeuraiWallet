// The decisions the Neurai Connect approval screens make.
//
// The screens themselves are not rendered here — this repository has no
// renderer wired up for them — so everything worth pinning was pulled out into
// `screen/connect/logic.ts` and is exercised directly. What is pinned is what
// the protocol fixes and what a refactor could silently break:
//
//   * which address a login defaults to, including the case where the site's
//     preference cannot be honoured;
//   * when "Approve" must be unavailable, and why;
//   * what a `sendTransfer` shows before the wallet refuses it;
//   * that an unimplemented method is refused with 4200 and not with silence.

// `screen/connect/logic.ts` is deliberately free of React Native and of the
// relay client, so nothing native has to be mocked to reach it. The keychain is
// stubbed anyway because the module graph of a screen test is easy to widen by
// accident, and a test that silently starts touching the real secure store is a
// test that starts failing on CI for reasons that have nothing to do with it.
import {
  CONNECT_EMPTY_FIELD,
  addressFromCaip10,
  caip10Account,
  defaultAddressKind,
  describeError,
  formatMoment,
  isValidRelayUrl,
  loginApproval,
  methodHandling,
  normalizeAddressPolicy,
  pickChain,
  proposalNamespaces,
  relayHost,
  screenForIncoming,
  sessionApproval,
  sessionProperties,
  shorten,
  signMessageText,
  summariseSendTransfer,
  unsupportedMethodError,
} from '../../screen/connect/logic';

const keyStore = new Map<string, string>();
jest.mock('react-native-secure-key-store', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async (k: string, v: string) => {
      keyStore.set(k, v);
    }),
    get: jest.fn(async (k: string) => {
      if (!keyStore.has(k)) throw new Error('not found');
      return keyStore.get(k);
    }),
    remove: jest.fn(async (k: string) => {
      keyStore.delete(k);
    }),
  },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
}));

const MAINNET = 'bip122:00000044d33c0c0ba019be5c02497304';
const TESTNET = 'bip122:0000009697907b2aa409d4b1f10da0fa';

describe('addressPolicy', () => {
  it('treats anything that is not "wallet" as the identity default', () => {
    // spec/auth.md 2.1: absent means "identity", and an unknown value means absent.
    expect(normalizeAddressPolicy(undefined)).toBe('identity');
    expect(normalizeAddressPolicy('identity')).toBe('identity');
    expect(normalizeAddressPolicy('IDENTITY')).toBe('identity');
    expect(normalizeAddressPolicy('something-else')).toBe('identity');
    expect(normalizeAddressPolicy(null)).toBe('identity');
    expect(normalizeAddressPolicy('wallet')).toBe('wallet');
  });

  it('honours the site preference when an identity can be derived', () => {
    expect(defaultAddressKind(undefined, true)).toBe('identity');
    expect(defaultAddressKind('wallet', true)).toBe('wallet');
  });

  it('falls back to a wallet address when this wallet has no identities', () => {
    // Post-quantum and hardware wallets have no BIP44 account 101 to derive from.
    expect(defaultAddressKind(undefined, false)).toBe('wallet');
    expect(defaultAddressKind('identity', false)).toBe('wallet');
  });
});

describe('when a login may be approved', () => {
  const base = {
    hasWallet: true,
    isHardwareWallet: false,
    addressKind: 'identity' as const,
    identityAvailable: true,
    address: 'NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc',
  };

  it('allows a fully resolved login', () => {
    expect(loginApproval(base)).toEqual({ canApprove: true });
  });

  it('refuses when there is no wallet of the requested network', () => {
    expect(loginApproval({ ...base, hasWallet: false })).toEqual({ canApprove: false, blocker: 'no_wallet' });
  });

  it('refuses on a hardware wallet, whichever address was picked', () => {
    expect(loginApproval({ ...base, isHardwareWallet: true })).toEqual({ canApprove: false, blocker: 'hardware' });
    expect(loginApproval({ ...base, isHardwareWallet: true, addressKind: 'wallet', identityAvailable: false })).toEqual({
      canApprove: false,
      blocker: 'hardware',
    });
  });

  it('refuses a post-quantum wallet asked for an identity address, but not for a wallet one', () => {
    expect(loginApproval({ ...base, identityAvailable: false })).toEqual({ canApprove: false, blocker: 'no_identity' });
    expect(loginApproval({ ...base, identityAvailable: false, addressKind: 'wallet' })).toEqual({ canApprove: true });
  });

  it('refuses a request that lapsed while the screen was open', () => {
    expect(loginApproval({ ...base, expired: true })).toEqual({ canApprove: false, blocker: 'expired' });
  });

  it('refuses while the address is still being derived', () => {
    expect(loginApproval({ ...base, address: undefined })).toEqual({ canApprove: false, blocker: 'no_address' });
  });
});

describe('session proposals', () => {
  it('needs only a wallet with an address: signing is decided per request', () => {
    expect(sessionApproval({ hasWallet: true, address: 'NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc' })).toEqual({ canApprove: true });
    expect(sessionApproval({ hasWallet: false })).toEqual({ canApprove: false, blocker: 'no_wallet' });
    expect(sessionApproval({ hasWallet: true })).toEqual({ canApprove: false, blocker: 'no_address' });
  });

  it('grants exactly the methods and events asked for, on one chain, with one wallet account', () => {
    const namespaces = proposalNamespaces({ methods: ['signMessage'], events: ['bip122_addressesChanged'] }, MAINNET, 'NX7s');
    expect(namespaces).toEqual({
      bip122: {
        chains: [MAINNET],
        accounts: [`${MAINNET}:NX7s`],
        methods: ['signMessage'],
        events: ['bip122_addressesChanged'],
      },
    });
  });

  it('grants nothing when the proposal asked for nothing', () => {
    expect(proposalNamespaces(undefined, MAINNET, 'NX7s').bip122.methods).toEqual([]);
    expect(proposalNamespaces(undefined, MAINNET, 'NX7s').bip122.events).toEqual([]);
  });

  it('hands the initial getAccountAddresses answer over as a JSON session property', () => {
    const props = sessionProperties([{ address: 'NX7s', path: "m/44'/1900'/0'/0/0" }]);
    expect(JSON.parse(props.bip122_getAccountAddresses)).toEqual([{ address: 'NX7s', path: "m/44'/1900'/0'/0/0" }]);
  });

  it('round-trips a CAIP-10 account', () => {
    expect(addressFromCaip10(caip10Account(TESTNET, 'tAbC'))).toBe('tAbC');
    expect(addressFromCaip10(undefined)).toBeUndefined();
    expect(addressFromCaip10('no-colons-here')).toBeUndefined();
  });
});

describe('picking the chain to answer on', () => {
  it('prefers a chain this wallet can serve', () => {
    expect(pickChain(['eip155:1', TESTNET], c => c.startsWith('bip122:'))).toBe(TESTNET);
  });

  it('falls back to the first chain so the screen can still explain itself', () => {
    expect(pickChain(['eip155:1'], c => c.startsWith('bip122:'))).toBe('eip155:1');
    expect(pickChain(undefined, () => true)).toBeUndefined();
    expect(pickChain([], () => true)).toBeUndefined();
  });
});

describe('session requests', () => {
  it('routes each method to the amount of friction it deserves', () => {
    expect(methodHandling('getAccountAddresses')).toBe('answer');
    expect(methodHandling('signMessage')).toBe('sign');
    expect(methodHandling('sendTransfer')).toBe('unsupported');
    expect(methodHandling('signPsbt')).toBe('unsupported');
    expect(methodHandling('neurai_somethingNew')).toBe('unsupported');
  });

  it('refuses the unimplemented methods with 4200 and the agreed wording', () => {
    expect(unsupportedMethodError('sendTransfer')).toEqual({ code: 4200, message: 'sendTransfer is not implemented yet' });
    expect(unsupportedMethodError('signPsbt')).toEqual({ code: 4200, message: 'signPsbt is not implemented yet' });
    expect(unsupportedMethodError('whatever')).toEqual({ code: 4200, message: 'whatever is not supported by this wallet' });
  });

  it('reads the message of a signMessage without trusting its shape', () => {
    expect(signMessageText({ message: 'hello' })).toBe('hello');
    expect(signMessageText({ message: 42 })).toBe('');
    expect(signMessageText(undefined)).toBe('');
    expect(signMessageText('hello')).toBe('');
  });
});

describe('what a sendTransfer shows', () => {
  it('shows destination, amount in XNA and memo', () => {
    expect(summariseSendTransfer({ recipientAddress: 'NX7s', amount: '12.5', memo: 'invoice 7' })).toEqual({
      destination: 'NX7s',
      amount: '12.5 XNA',
      memo: 'invoice 7',
    });
  });

  it('accepts the toAddress spelling and a numeric amount', () => {
    expect(summariseSendTransfer({ toAddress: 'tAbC', amount: 3 })).toEqual({
      destination: 'tAbC',
      amount: '3 XNA',
      memo: CONNECT_EMPTY_FIELD,
    });
  });

  it('names the asset when the transfer is not the base currency', () => {
    expect(summariseSendTransfer({ recipientAddress: 'NX7s', amount: '1', assetName: 'MYASSET' }).amount).toBe('1 MYASSET');
  });

  it('renders every missing field instead of hiding it', () => {
    // A transfer with nothing in it must look empty to the user, not tidy.
    expect(summariseSendTransfer({})).toEqual({
      destination: CONNECT_EMPTY_FIELD,
      amount: CONNECT_EMPTY_FIELD,
      memo: CONNECT_EMPTY_FIELD,
    });
    expect(summariseSendTransfer(undefined).destination).toBe(CONNECT_EMPTY_FIELD);
    expect(summariseSendTransfer({ amount: '' }).amount).toBe(CONNECT_EMPTY_FIELD);
  });
});

describe('routing an incoming item', () => {
  it('sends each kind to its own approval screen', () => {
    expect(screenForIncoming('auth')).toBe('ConnectLogin');
    expect(screenForIncoming('proposal')).toBe('ConnectProposal');
    expect(screenForIncoming('request')).toBe('ConnectRequest');
  });
});

describe('the relay field', () => {
  it('accepts only WebSocket URLs', () => {
    expect(isValidRelayUrl('wss://relay.neurai.org/v1')).toBe(true);
    expect(isValidRelayUrl('  ws://10.0.2.2:8080/v1  ')).toBe(true);
    expect(isValidRelayUrl('https://relay.neurai.org/v1')).toBe(false);
    expect(isValidRelayUrl('relay.neurai.org')).toBe(false);
    expect(isValidRelayUrl('wss://')).toBe(false);
    expect(isValidRelayUrl('')).toBe(false);
  });

  it('shows the host the wallet is talking to, and the raw value when there is none', () => {
    // The parser itself, and the case React Native's URL got wrong, are covered
    // in neurai-connect-relay-url.test.ts.
    expect(relayHost('wss://relay.neurai.org/v1')).toBe('relay.neurai.org');
  });
});

describe('formatting', () => {
  it('never prints an unreadable date as a date', () => {
    expect(formatMoment(undefined)).toBe(CONNECT_EMPTY_FIELD);
    expect(formatMoment('')).toBe(CONNECT_EMPTY_FIELD);
    expect(formatMoment('not-a-date')).toBe(CONNECT_EMPTY_FIELD);
    expect(formatMoment('2026-09-04T10:00:00Z')).not.toBe(CONNECT_EMPTY_FIELD);
    expect(formatMoment(1_788_000_000_000)).not.toBe(CONNECT_EMPTY_FIELD);
  });

  it('shortens only what is too long to read', () => {
    expect(shorten('NX7syq', 10)).toBe('NX7syq');
    expect(shorten('NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc', 6)).toBe('NX7syq…Sq9Azc');
  });

  it('always produces a message out of whatever was thrown', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('boom')).toBe('boom');
    expect(describeError(undefined)).toBe('undefined');
  });
});
