import { fakePool, sdk } from './helpers/depin-rpc5';
import { getVerifiedPool, getVerifiedPoolStats, DepinPoolPinMismatchError } from '../../blue_modules/neurai/depinPool';
import { sendDepinPrivateMessage, softwareIdentity } from '../../blue_modules/neurai/depinSend';
import { receiveDepinPage, readableMessages } from '../../blue_modules/neurai/depinReceive';
import { poolSignature } from '../../blue_modules/neurai/depinPoolSeen';

for (const family of ['legacy', 'strict'] as const) {
  test(`${family}: signed private send, receipt, sender verification, decryption and exact cursor`, async () => {
    const node = await fakePool(),
      identity = node[family],
      pool = await node.verified();
    const recipient = family === 'legacy' ? node.strict : node.legacy;
    const result = await sendDepinPrivateMessage({
      call: node.call,
      pool,
      identity,
      token: 'TEST/NEWS',
      toAddress: recipient.address,
      message: 'hello',
      timestamp: 1700000000,
      network: 'testnet',
      senderPubKey: identity.publicKey,
      privateKey: 'unused',
    });
    expect(result.recipientCount).toBe(2);
    expect(result.messageHash).toBe(node.messages[0].hash);
    const page = await receiveDepinPage({ call: node.call, pool, identity: recipient, token: '&TEST/NEWS', network: 'testnet' });
    expect(readableMessages(page.messages)[0].plaintext).toBe(`@${recipient.address} hello`);
    expect(page.cursor.after_seq).toBe(9007199254740993n);
    const next = await receiveDepinPage({
      call: node.call,
      pool,
      identity: recipient,
      token: '&TEST/NEWS',
      network: 'testnet',
      previous: page.next,
      cursor: page.cursor,
    });
    expect(next.messages).toEqual([]);
    expect(node.call.mock.calls.slice(-1)[0]![1][0]).toMatchObject({ args: { cursor: { after_seq: 9007199254740993n } } });
  });
}
test('software signing retains the selected strict identity instead of deriving a Legacy alias', async () => {
  const node = await fakePool();
  const identity = await softwareIdentity('88'.repeat(32), 'testnet', node.strict.address);
  expect(identity.address).toBe(node.strict.address);
});
test('pool signatures are checked before the identity decryptor runs', async () => {
  const node = await fakePool(),
    pool = await node.verified();
  const opener = jest.fn(node.legacy.openReply);
  const identity = { ...node.legacy, openReply: opener };
  node.tamperNext();
  await expect(receiveDepinPage({ call: node.call, pool, identity, token: '&TEST', network: 'testnet' })).rejects.toThrow(/signature/);
  expect(opener).not.toHaveBeenCalled();
});
test('membership changes invalidate a still-live nonce and preserve sequence cursor during one bounded recovery', async () => {
  const node = await fakePool(),
    pool = await node.verified();
  const params = { call: node.call, pool, identity: node.legacy, token: '&TEST', network: 'testnet' };
  const first = await receiveDepinPage(params);
  const old = first.next;
  node.changeMembership();
  const second = await receiveDepinPage({ ...params, previous: old, cursor: first.cursor, refreshPool: node.verified });
  expect(second.membershipChanged).toBe(true);
  expect(second.cursor.stream_id).toBe(first.cursor.stream_id);
  expect(second.next?.contextKey).not.toBe(old?.contextKey);
  expect(node.call.mock.calls.filter(([method]) => method === 'depinchallenge')).toHaveLength(2);
});
test('fresh bootstrap revision renews cached nonces for every identity', async () => {
  const node = await fakePool();
  const pool = await node.verified();
  const states = await Promise.all(
    [node.legacy, node.strict].map((identity) => receiveDepinPage({ call: node.call, pool, identity, token: '&TEST', network: 'testnet' })),
  );
  node.changeMembership();
  const fresh = await node.verified();
  const before = node.call.mock.calls.filter(([m]) => m === 'depinchallenge').length;
  for (let i = 0; i < 2; i++)
    await receiveDepinPage({
      call: node.call,
      pool: fresh,
      identity: [node.legacy, node.strict][i],
      token: '&TEST',
      network: 'testnet',
      previous: states[i].next,
      cursor: states[i].cursor,
    });
  expect(node.call.mock.calls.filter(([m]) => m === 'depinchallenge').length - before).toBe(2);
});
test('signed stats include verified stream, revision and high water for change detection', async () => {
  const node = await fakePool(),
    pool = await node.verified();
  const stats = await getVerifiedPoolStats({ call: node.call, pool });
  expect(stats.admission_sequence).toBe(9007199254740992n);
  expect(poolSignature(stats)).toContain('9007199254740992');
  node.changeMembership();
  const changed = await getVerifiedPoolStats({ call: node.call, pool });
  expect(poolSignature(changed)).not.toBe(poolSignature(stats));
});
test('a response from another pinned key is refused; there is no automatic re-pin', async () => {
  const node = await fakePool();
  await node.verified();
  const other = await sdk.createSoftwareIdentity({ privateKey: 'aa'.repeat(32), network: 'test' });
  const call = async (method: string, params: unknown[]) => {
    const result: any = await node.call(method, params);
    result.pool_pubkey = other.publicKey;
    result.poolsig = sdk.signRecoverableMessage(
      sdk.buildDepinRpcResponsePreimage({ method, reply: result, requestHash: result.request_hash }),
      'aa'.repeat(32),
    );
    return result;
  };
  await expect(getVerifiedPool({ call, network: 'testnet', url: node.url })).rejects.toBeInstanceOf(DepinPoolPinMismatchError);
});
