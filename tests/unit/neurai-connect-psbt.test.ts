// signPsbt for Neurai Connect.
//
// A site sends a transaction as a PSBT and names the inputs to sign. The
// wallet must show what it does (outputs, what comes back, fee) and refuse
// what it must not sign; what it signs must finalize, on the site's side, into
// exactly the transaction the wallet's own signer would produce.

import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { getAddressPair } from '@neuraiproject/neurai-key';
import { createPaymentTransaction } from '@neuraiproject/neurai-create-transaction';
import { sign as signTransaction } from '@neuraiproject/neurai-sign-transaction';
import { finalizeSignedPSBT } from '@neuraiproject/neurai-sign-esp32';
import {
  PSBT_ERROR_INVALID,
  PSBT_ERROR_UNAUTHORIZED,
  PsbtRequestError,
  decodeAssetSuffix,
  inspectSignPsbt,
  scriptToAddress,
  signPsbtWithWallet,
  type PsbtWallet,
} from '../../blue_modules/neurai/connect/psbt';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
type Key = { address: string; WIF: string };
const external = (network: 'xna-legacy-test' | 'xna-test', index: number): Key =>
  (getAddressPair(network, MNEMONIC, 0, index) as unknown as { external: Key }).external;

const legacy = external('xna-legacy-test', 0);
const ecdsa = external('xna-test', 0);
const stranger = external('xna-legacy-test', 7);

/** A wallet that owns `keys` (and nothing else). */
function walletOf(...keys: Key[]): PsbtWallet {
  return {
    weOwnAddress: address => keys.some(k => k.address === address),
    getMessageSigningMaterial: async address => {
      const key = keys.find(k => k.address === address);
      return key ? { kind: 'legacy', wif: key.WIF } : false;
    },
  };
}

const fakeTxid = (n: number) => n.toString(16).padStart(64, '0');
const fund = (address: string, sats: bigint, n: number) =>
  createPaymentTransaction({ inputs: [{ txid: fakeTxid(n), vout: 0 }], payments: [{ address, valueSats: sats }] }).rawTx;
const txid = (hex: string) => bitcoin.Transaction.fromHex(hex).getId();
const scriptOf = (hex: string) => Buffer.from(bitcoin.Transaction.fromHex(hex).outs[0].script).toString('hex');

/** The PSBT the extension builds: every input with its previous transaction. */
function psbtFor(unsignedHex: string, prevTxs: string[]): string {
  const tx = bitcoin.Transaction.fromHex(unsignedHex);
  const psbt = new bitcoin.Psbt();
  psbt.setVersion(tx.version);
  psbt.setLocktime(tx.locktime);
  tx.ins.forEach((input, i) => {
    psbt.addInput({ hash: input.hash, index: input.index, sequence: input.sequence, nonWitnessUtxo: Buffer.from(prevTxs[i], 'hex') });
  });
  tx.outs.forEach(out => psbt.addOutput({ script: out.script, value: out.value }));
  return psbt.toBase64();
}

const fundEcdsa = fund(ecdsa.address, 1_000_000n, 1);
const fundLegacy = fund(legacy.address, 500_000n, 2);
const fundStranger = fund(stranger.address, 300_000n, 3);

describe('what the wallet shows before signing', () => {
  const unsigned = createPaymentTransaction({
    inputs: [{ txid: txid(fundEcdsa), vout: 0 }],
    payments: [
      { address: stranger.address, valueSats: 600_000n },
      { address: ecdsa.address, valueSats: 390_000n },
    ],
  }).rawTx;
  const params = {
    psbt: psbtFor(unsigned, [fundEcdsa]),
    signInputs: [{ address: ecdsa.address, index: 0, sighashTypes: [1] }],
    broadcast: false,
  };

  it('lists every output, marks what comes back and computes the fee', () => {
    const view = inspectSignPsbt(params, walletOf(ecdsa), true);
    expect(view.toSign).toEqual([{ index: 0, address: ecdsa.address, sats: 1_000_000n }]);
    expect(view.outputs.map(o => [o.address, o.sats, o.ownAddress])).toEqual([
      [stranger.address, 600_000n, false],
      [ecdsa.address, 390_000n, true],
    ]);
    expect(view.spentSats).toBe(610_000n);
    expect(view.feeSats).toBe(10_000n);
  });

  it('refuses inputs of another wallet, another address, or other sighash types', () => {
    const refusal = (p: unknown, wallet: PsbtWallet) => {
      try {
        inspectSignPsbt(p, wallet, true);
      } catch (error) {
        return error as PsbtRequestError;
      }
      throw new Error('accepted');
    };
    expect(refusal(params, walletOf(legacy)).code).toBe(PSBT_ERROR_UNAUTHORIZED);
    expect(refusal({ ...params, signInputs: [{ address: legacy.address, index: 0 }] }, walletOf(ecdsa, legacy)).code).toBe(
      PSBT_ERROR_INVALID,
    );
    expect(
      refusal({ ...params, signInputs: [{ address: ecdsa.address, index: 0, sighashTypes: [0x83] }] }, walletOf(ecdsa)).message,
    ).toMatch(/SIGHASH_ALL/);
    expect(refusal({ ...params, broadcast: true }, walletOf(ecdsa)).message).toMatch(/does not broadcast/);
    expect(refusal({ ...params, signInputs: [{ address: ecdsa.address, index: 3 }] }, walletOf(ecdsa)).message).toMatch(/no input 3/);
    expect(refusal({ ...params, psbt: 'not a psbt' }, walletOf(ecdsa)).message).toMatch(/not a PSBT/);
  });

  it('refuses a previous transaction that is not the one the input spends', () => {
    const forged = { ...params, psbt: psbtFor(unsigned, [fundLegacy]) };
    expect(() => inspectSignPsbt(forged, walletOf(ecdsa), true)).toThrow(/not the one it spends/);
  });
});

describe('what the wallet signs', () => {
  it('signs ECDSA witness v3 inputs that finalize into its own signature', async () => {
    const unsigned = createPaymentTransaction({
      inputs: [{ txid: txid(fundEcdsa), vout: 0 }],
      payments: [{ address: legacy.address, valueSats: 990_000n }],
    }).rawTx;
    const psbt = psbtFor(unsigned, [fundEcdsa]);
    const signed = await signPsbtWithWallet({ psbt, signInputs: [{ address: ecdsa.address, index: 0 }] }, walletOf(ecdsa), true);
    const expected = signTransaction(
      'xna-test',
      unsigned,
      [
        {
          address: ecdsa.address,
          assetName: 'XNA',
          txid: txid(fundEcdsa),
          outputIndex: 0,
          script: scriptOf(fundEcdsa),
          satoshis: 1_000_000,
          value: 1_000_000,
        },
      ],
      { [ecdsa.address]: ecdsa.WIF },
      { debug: false },
    );
    expect(finalizeSignedPSBT(psbt, signed, 'xna-test').txHex).toBe(expected);
  });

  it('signs only its inputs of a mixed transaction, P2PKH included', async () => {
    const unsigned = createPaymentTransaction({
      inputs: [
        { txid: txid(fundStranger), vout: 0 },
        { txid: txid(fundLegacy), vout: 0 },
      ],
      payments: [{ address: ecdsa.address, valueSats: 790_000n }],
    }).rawTx;
    const psbt = psbtFor(unsigned, [fundStranger, fundLegacy]);
    const signed = bitcoin.Psbt.fromBase64(
      await signPsbtWithWallet({ psbt, signInputs: [{ address: legacy.address, index: 1 }] }, walletOf(legacy), true),
    );
    expect(signed.data.inputs[0].partialSig).toBeUndefined();
    expect(signed.data.inputs[1].partialSig).toHaveLength(1);
  });
});

describe('decoding scripts', () => {
  it('turns every family back into its address', () => {
    expect(scriptToAddress(scriptOf(fundLegacy), true)).toBe(legacy.address);
    expect(scriptToAddress(scriptOf(fundEcdsa), true)).toBe(ecdsa.address);
    expect(scriptToAddress('6a0401020304', true)).toBeNull();
  });

  it('reads the asset an output carries', () => {
    const name = Buffer.from('MYASSET', 'utf8');
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(150_000_000n);
    const payload = Buffer.concat([Buffer.from('xnat', 'latin1'), Buffer.from([name.length]), name, amount]);
    const script = Buffer.concat([
      Buffer.from(scriptOf(fundLegacy), 'hex'),
      Buffer.from([0xc0, payload.length]),
      payload,
      Buffer.from([0x75]),
    ]);
    expect(decodeAssetSuffix(script)).toEqual({ name: 'MYASSET', amount: '1.5', operation: 'transfer' });
    expect(decodeAssetSuffix(Buffer.from(scriptOf(fundLegacy), 'hex'))).toBeNull();
  });
});
