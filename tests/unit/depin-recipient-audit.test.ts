// Auditing the recipient set against an independent node.
//
// The messaging server decides who a message is encrypted to. The library
// already refuses a public key that does not hash to its address, so the one
// remaining move is for the server to add an address it controls. Whether an
// address holds the token is on-chain data, so a DIFFERENT node can settle it.
//
// The point these tests protect: the audit must never claim to have verified
// anything when it could not consult a genuinely different endpoint.

import { auditRecipients, trustedAuditUrl } from '../../blue_modules/neurai/depinRecipientAudit';

const getDepinRpcConfig = jest.fn();
jest.mock('../../blue_modules/neurai', () => ({
  __esModule: true,
  chainFor: (network: string) => (network === 'testnet' ? 'xna-test' : 'xna'),
  getDepinRpcConfig: (...a: unknown[]) => getDepinRpcConfig(...a),
}));

jest.mock('../../blue_modules/neurai/networkConfig', () => ({
  __esModule: true,
  CHAIN_PARAMS: {
    'xna-test': { defaultRpcUrl: 'https://trusted.example.org/rpc' },
    xna: { defaultRpcUrl: 'https://trusted-main.example.org/rpc' },
  },
}));

const HOLDER_A = 'tAAA';
const HOLDER_B = 'tBBB';
const INTRUDER = 'tEVIL';

const mockFetch = (holders: unknown, ok = true) => {
  global.fetch = jest.fn(async () => ({
    json: async () => (ok ? { result: holders } : { error: { code: -1, message: 'nope' } }),
  })) as unknown as typeof fetch;
};

beforeEach(() => {
  getDepinRpcConfig.mockReturnValue({ url: 'https://depin.example.org/rpc' });
});

describe('auditRecipients', () => {
  it('confirms a recipient set that matches the independent node', async () => {
    mockFetch([
      { address: HOLDER_A, amount: 1, valid: 1 },
      { address: HOLDER_B, amount: 5, valid: 1 },
    ]);
    const audit = await auditRecipients({ addresses: [HOLDER_A, HOLDER_B], token: '&TOK', network: 'testnet' });

    expect(audit.independent).toBe(true);
    expect(audit.ok).toBe(true);
    expect(audit.unconfirmed).toEqual([]);
  });

  it('CATCHES an address the messaging server injected', async () => {
    // The attack the audit exists for: an address with a matching key of its
    // own, which the library cannot distinguish from a real holder.
    mockFetch([{ address: HOLDER_A, amount: 1, valid: 1 }]);
    const audit = await auditRecipients({ addresses: [HOLDER_A, INTRUDER], token: '&TOK', network: 'testnet' });

    expect(audit.ok).toBe(false);
    expect(audit.unconfirmed).toEqual([INTRUDER]);
  });

  it('treats a blocked holder as not confirmed', async () => {
    mockFetch([{ address: HOLDER_A, amount: 1, valid: 0 }]);
    const audit = await auditRecipients({ addresses: [HOLDER_A], token: '&TOK', network: 'testnet' });
    expect(audit.unconfirmed).toEqual([HOLDER_A]);
  });

  it('claims NOTHING when both endpoints are the same machine', async () => {
    // Today's default: one server wearing two names is one source.
    getDepinRpcConfig.mockReturnValue({ url: 'https://trusted.example.org/rpc/' });
    const audit = await auditRecipients({ addresses: [INTRUDER], token: '&TOK', network: 'testnet' });

    expect(audit.independent).toBe(false);
    expect(audit.ok).toBe(false);
    expect(audit.unconfirmed).toEqual([]);
  });

  it('an unreachable auditor is reported, not thrown', async () => {
    // A node being down is not proof of an attack, and must not break sending.
    mockFetch(null, false);
    const audit = await auditRecipients({ addresses: [HOLDER_A], token: '&TOK', network: 'testnet' });

    expect(audit.ok).toBe(false);
    expect(audit.error).toBeInstanceOf(Error);
    expect(audit.independent).toBe(true);
  });
});

describe('trustedAuditUrl', () => {
  it("is the app's own default, never the DePIN override", () => {
    getDepinRpcConfig.mockReturnValue({ url: 'https://depin.example.org/rpc' });
    expect(trustedAuditUrl('testnet')).toBe('https://trusted.example.org/rpc');
  });
});
