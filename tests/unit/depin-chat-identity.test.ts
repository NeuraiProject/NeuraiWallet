import { deriveDepinChatIdentity, isDepinChatSupportedNetwork } from '../../blue_modules/neurai/depinChatIdentity';
import { softwareIdentity } from '../../blue_modules/neurai/depinSend';
import { sdk } from './helpers/depin-rpc5';
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
for (const network of ['xna', 'xna-test', 'xna-ecdsa', 'xna-ecdsa-test'] as const) {
  test(`${network} derives its own account-100 chat identity and matches the SDK`, async () => {
    expect(isDepinChatSupportedNetwork(network)).toBe(true);
    const identity = deriveDepinChatIdentity({ network, mnemonic });
    expect(identity.path).toContain(network.includes('ecdsa') ? "m/84'/" : "m/44'/");
    expect(identity.path).toContain("/100'/0/0");
    expect((await softwareIdentity(identity.wif, network, identity.address)).address).toBe(identity.address);
    expect((await sdk.decodeDepinAddress(identity.address)).type).toBe(network.includes('ecdsa') ? 'ecdsa' : 'legacy');
  });
}
test.each(['xna-pq', 'xna-pq-test'])('%s remains outside the supported chat families', (network) =>
  expect(isDepinChatSupportedNetwork(network)).toBe(false),
);
test('an ECDSA key can explicitly use its Legacy alias when that address owns the permission', async () => {
  const identity = deriveDepinChatIdentity({ network: 'xna-ecdsa-test', mnemonic });
  const alias = await sdk.base58CheckEncode(127, await sdk.hash160(sdk.hexToBytes(identity.publicKey)));
  const signer = await softwareIdentity(identity.wif, 'testnet', alias);
  expect(signer.address).toBe(alias);
  const sig = await signer.signMessage('probe');
  expect(sdk.recoverPublicKeyFromMessage('probe', sig)).toBe(identity.publicKey);
});
