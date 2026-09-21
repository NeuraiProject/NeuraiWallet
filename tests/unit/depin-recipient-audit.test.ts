import { auditRecipients, trustedAuditUrl } from '../../blue_modules/neurai/depinRecipientAudit';
jest.mock('../../blue_modules/neurai', () => ({
  getDepinRpcConfig: (network: string) => ({ url: `wss://wallet-${network}/push` }),
}));
test.each(['mainnet', 'testnet'] as const)('a single WSS service is not an independent recipient auditor (%s)', async network => {
  const previous = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error('HTTP forbidden');
  });
  try {
    const result = await auditRecipients({ addresses: ['recipient'], token: '&TOKEN', network });
    expect(result).toEqual({ independent: false, ok: false, unconfirmed: [], auditUrl: `wss://wallet-${network}/push` });
    expect(trustedAuditUrl(network)).toBe(result.auditUrl);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    global.fetch = previous;
  }
});
