// Signing for Neurai Connect.
//
// Every signature the wallet hands a web site goes through `signConnectMessage`,
// so this pins the two formats the Neurai node validates and the guarantee the
// signer makes: it verifies its own output before returning it, and it refuses
// rather than signing with the wrong kind of key.

import { getAddressPair, getPQAddress } from '@neuraiproject/neurai-key';
import { verifyMessage } from '@neuraiproject/neurai-message';
import { SIGNATURE_TYPE_LEGACY, SIGNATURE_TYPE_PQ, signConnectMessage } from '../../blue_modules/neurai/connect/signer';
import type { AbstractNeuraiWallet, NeuraiSigningMaterial } from '../../class/wallets/abstract-neurai-wallet';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MESSAGE = 'example.com wants you to sign in with your Neurai account:\nsomething';

/** A wallet stub: the signer only needs the network and the signing material. */
const walletStub = (network: string, material: NeuraiSigningMaterial | false): AbstractNeuraiWallet =>
  ({ network, secret: MNEMONIC, getMessageSigningMaterial: async () => material }) as unknown as AbstractNeuraiWallet;

describe('legacy addresses', () => {
  const pair = getAddressPair('xna-test', MNEMONIC, 0, 0);
  const external =
    (pair as unknown as { external?: { address: string; WIF: string } }).external ?? (pair as unknown as { address: string; WIF: string });

  it('produces a signature that verifies against the address', async () => {
    const wallet = walletStub('xna-test', { kind: 'legacy', wif: external.WIF });
    const signed = await signConnectMessage(wallet, external.address, MESSAGE);
    expect(signed.type).toBe(SIGNATURE_TYPE_LEGACY);
    expect(signed.address).toBe(external.address);
    expect(verifyMessage(MESSAGE, external.address, signed.signature)).toBe(true);
    // Deterministic (RFC 6979): the same message and key always give the same signature.
    const again = await signConnectMessage(wallet, external.address, MESSAGE);
    expect(again.signature).toBe(signed.signature);
  });

  it('does not verify for a different message', async () => {
    const wallet = walletStub('xna-test', { kind: 'legacy', wif: external.WIF });
    const signed = await signConnectMessage(wallet, external.address, MESSAGE);
    expect(verifyMessage(MESSAGE + '!', external.address, signed.signature)).toBe(false);
  });
});

describe('post-quantum addresses', () => {
  const pq = getPQAddress('xna-pq-test', MNEMONIC, 0, 0) as unknown as { address: string; seedKey: string; publicKey: string };

  it('expands the stored seed into the signing key and verifies the result', async () => {
    const wallet = walletStub('xna-pq-test', { kind: 'pq', seedKey: pq.seedKey, publicKey: pq.publicKey });
    const signed = await signConnectMessage(wallet, pq.address, MESSAGE);
    expect(signed.type).toBe(SIGNATURE_TYPE_PQ);
    expect(verifyMessage(MESSAGE, pq.address, signed.signature)).toBe(true);
  });

  it('refuses when the seed does not expand to the stored public key', async () => {
    const wrongSeed = '11'.repeat(32);
    const wallet = walletStub('xna-pq-test', { kind: 'pq', seedKey: wrongSeed, publicKey: pq.publicKey });
    await expect(signConnectMessage(wallet, pq.address, MESSAGE)).rejects.toThrow(/does not match the stored public key/);
  });
});

describe('refusals', () => {
  it('refuses when the wallet holds no key for the address (hardware wallets)', async () => {
    const wallet = walletStub('xna-test', false);
    await expect(signConnectMessage(wallet, 'tCEDTHevFvG9CF6SCw3c4E7yxi9Tmnvr2x', MESSAGE)).rejects.toThrow(
      /hardware wallets are not supported/,
    );
  });

  it('refuses to cross key kinds', async () => {
    const pq = getPQAddress('xna-pq-test', MNEMONIC, 0, 0) as unknown as { address: string; seedKey: string; publicKey: string };
    const pair = getAddressPair('xna-test', MNEMONIC, 0, 0);
    const external =
      (pair as unknown as { external?: { address: string; WIF: string } }).external ??
      (pair as unknown as { address: string; WIF: string });

    const legacyKeyForPqAddress = walletStub('xna-test', { kind: 'legacy', wif: external.WIF });
    await expect(signConnectMessage(legacyKeyForPqAddress, pq.address, MESSAGE)).rejects.toThrow(
      /post-quantum address cannot be signed with a legacy key/,
    );

    const pqKeyForLegacyAddress = walletStub('xna-pq-test', { kind: 'pq', seedKey: pq.seedKey, publicKey: pq.publicKey });
    await expect(signConnectMessage(pqKeyForLegacyAddress, external.address, MESSAGE)).rejects.toThrow(
      /legacy address cannot be signed with a post-quantum key/,
    );
  });

  it('refuses without an address', async () => {
    const wallet = walletStub('xna-test', { kind: 'legacy', wif: 'x' });
    await expect(signConnectMessage(wallet, '', MESSAGE)).rejects.toThrow(/no address/);
  });
});
