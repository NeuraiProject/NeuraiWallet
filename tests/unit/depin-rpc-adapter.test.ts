import { createDepinRpc, depinServiceId } from '../../blue_modules/neurai/depinRpcAdapter';

describe('createDepinRpc', () => {
  it('exposes the call(method, params) shape the library asserts on', async () => {
    const seen: Array<[string, unknown[]]> = [];
    const rpc = createDepinRpc(async (method, params) => {
      seen.push([method, params]);
      return { ok: true };
    });
    await expect(rpc.call('depingetmsginfo')).resolves.toEqual({ ok: true });
    expect(seen).toEqual([['depingetmsginfo', []]]);
  });

  it('passes params through untouched', async () => {
    const seen: unknown[] = [];
    const rpc = createDepinRpc(async (_m, params) => {
      seen.push(params);
      return null;
    });
    await rpc.call('depinreceivemsg', ['&TOK', 'addr', 'challenge', 'sig']);
    expect(seen[0]).toEqual(['&TOK', 'addr', 'challenge', 'sig']);
  });

  it('refuses anything that is not callable', () => {
    expect(() => createDepinRpc(undefined as never)).toThrow(/call\(method, params\)/);
  });
});

describe('depinServiceId', () => {
  it('is stable for the same endpoint', () => {
    expect(depinServiceId('xna-test', 'https://rpc.example.org/rpc')).toBe(depinServiceId('xna-test', 'https://rpc.example.org/rpc/'));
  });

  it('separates networks so a pin cannot cross chains', () => {
    expect(depinServiceId('xna', 'https://rpc.example.org/rpc')).not.toBe(depinServiceId('xna-test', 'https://rpc.example.org/rpc'));
  });

  it('never carries credentials into the identity', () => {
    // Credentials rotate without the endpoint changing, and must not be persisted.
    const id = depinServiceId('xna-test', 'https://user:secret@rpc.example.org/rpc');
    expect(id).not.toContain('secret');
    expect(id).not.toContain('user');
    expect(id).toBe(depinServiceId('xna-test', 'https://rpc.example.org/rpc'));
  });

  it('distinguishes different endpoints', () => {
    expect(depinServiceId('xna-test', 'https://a.example.org/rpc')).not.toBe(depinServiceId('xna-test', 'https://b.example.org/rpc'));
  });
});
