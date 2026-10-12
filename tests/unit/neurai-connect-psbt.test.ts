// signPsbt for Neurai Connect.
//
// A site sends a transaction as a PSBT and names the inputs to sign. The
// wallet must show what it does (outputs, what comes back, fee) and refuse
// what it must not sign; what it signs must finalize, on the site's side, into
// exactly the transaction the wallet's own signer would produce.

import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { getAddressPair, getNoAuthAddress } from '@neuraiproject/neurai-key';
import {
  computeTxid,
  createAssetTransferOutput,
  createPaymentTransaction,
  createPsbt,
  createXnaOutput,
  extractPsbtTransaction,
  finalizePsbt,
  serializeTransaction,
  updatePsbtInput,
} from '@neuraiproject/neurai-create-transaction';
import { buildPartialFillScriptHex, buildPartialFillScriptPQHex } from '@neuraiproject/neurai-scripts';
import { sign as signTransaction } from '@neuraiproject/neurai-sign-transaction';
import { buildPSBTFromRawTransaction, finalizeSignedPSBT } from '@neuraiproject/neurai-sign-esp32';
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
type Key = { address: string; WIF: string; publicKey: string };
const external = (network: 'xna-legacy-test' | 'xna-test', index: number): Key =>
  (getAddressPair(network, MNEMONIC, 0, index) as unknown as { external: Key }).external;

const legacy = external('xna-legacy-test', 0);
const legacy2 = external('xna-legacy-test', 1);
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
    expect(refusal({ ...params, psbt: 'not a psbt' }, walletOf(ecdsa)).message).toMatch(/not a valid PSBT/);
  });

  it('refuses a previous transaction that is not the one the input spends', () => {
    const forged = { ...params, psbt: psbtFor(unsigned, [fundLegacy]) };
    expect(() => inspectSignPsbt(forged, walletOf(ecdsa), true)).toThrow(/the previous transaction is [0-9a-f]{64}, but the input spends/);
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

describe('previous transactions of version 3', () => {
  // Privacy pools and state threads create Neurai version-3 transactions: NIP-014
  // serializes their reference inputs (here one), which bitcoinjs-lib cannot read.
  const fundV3 = serializeTransaction({
    version: 3,
    inputs: [{ txid: fakeTxid(9), vout: 0, scriptSigHex: '', sequence: 0xffffffff }],
    outputs: [{ valueSats: 800_000n, scriptPubKeyHex: scriptOf(fundEcdsa) }],
    vrefin: [{ txid: fakeTxid(10), vout: 1 }],
    locktime: 0,
  });
  const fundV3Txid = computeTxid(fundV3);
  const unsigned = createPaymentTransaction({
    inputs: [{ txid: fundV3Txid, vout: 0 }],
    payments: [{ address: legacy.address, valueSats: 790_000n }],
  }).rawTx;
  // Built the way the extension builds it (neurai-sign-esp32 >= 0.7.2).
  const psbt = buildPSBTFromRawTransaction({
    network: 'xna-test',
    rawUnsignedTransaction: unsigned,
    inputs: [{ txid: fundV3Txid, vout: 0, rawTxHex: fundV3 }],
  });
  const params = { psbt, signInputs: [{ address: ecdsa.address, index: 0, sighashTypes: [1] }], broadcast: false };

  it('cannot be read by bitcoinjs-lib', () => {
    expect(() => bitcoin.Transaction.fromHex(fundV3)).toThrow(/unexpected data/);
  });

  it('are shown with the real amounts and fee', () => {
    const view = inspectSignPsbt(params, walletOf(ecdsa), true);
    expect(view.toSign).toEqual([{ index: 0, address: ecdsa.address, sats: 800_000n }]);
    expect(view.feeSats).toBe(10_000n);
  });

  it("are signed into the transaction the wallet's own signer produces", async () => {
    const signed = await signPsbtWithWallet(params, walletOf(ecdsa), true);
    const expected = signTransaction(
      'xna-test',
      unsigned,
      [
        {
          address: ecdsa.address,
          assetName: 'XNA',
          txid: fundV3Txid,
          outputIndex: 0,
          script: scriptOf(fundEcdsa),
          satoshis: 800_000,
          value: 800_000,
        },
      ],
      { [ecdsa.address]: ecdsa.WIF },
      { debug: false },
    );
    expect(finalizeSignedPSBT(psbt, signed, 'xna-test').txHex).toBe(expected);
  });
});

describe('cancelling one of its sell orders', () => {
  // A partial-fill order locks 7 STAYTOKEN in a NoAuth AuthScript output whose
  // witness script is the covenant; its seller cancels it with an ECDSA key.
  const COIN = 100_000_000n;
  const marker = { assetMarker: 'xna' as const };
  const keyHash = (key: Key) => new Uint8Array(bitcoin.crypto.hash160(Buffer.from(key.publicKey, 'hex')));
  const orderOf = (seller: Key) =>
    buildPartialFillScriptHex({
      paymentAddress: seller.address,
      sellerPubKeyHash: keyHash(seller),
      tokenId: 'STAYTOKEN',
      unitPriceSats: 1n,
    });
  const covenantAddress = (covenantHex: string) =>
    getNoAuthAddress('xna-authscript-test', { witnessScript: Buffer.from(covenantHex, 'hex') }).address;

  let n = 100;
  /** The cancel transaction the DEX builds (order at input 0, fee at input 1) and the PSBT the extension sends. */
  function cancellation(
    seller: Key,
    { covenantHex = orderOf(seller), refunds = [{ address: seller.address, raw: 7n * COIN }], prevVersion = 2 } = {},
  ) {
    n += 1;
    const prev = serializeTransaction({
      version: prevVersion,
      inputs: [{ txid: fakeTxid(n), vout: 0, scriptSigHex: '', sequence: 0xffffffff }],
      outputs: [
        createAssetTransferOutput(covenantAddress(covenantHex), 'STAYTOKEN', 7n * COIN, marker),
        createXnaOutput(seller.address, 2n * COIN),
      ],
      vrefin: prevVersion === 3 ? [{ txid: fakeTxid(n + 500), vout: 0 }] : [],
      locktime: 0,
    });
    const prevTxid = computeTxid(prev);
    const unsigned = serializeTransaction({
      version: 2,
      inputs: [0, 1].map(vout => ({ txid: prevTxid, vout, scriptSigHex: '', sequence: 0xffffffff })),
      outputs: [
        ...refunds.map(r => createAssetTransferOutput(r.address, 'STAYTOKEN', r.raw, marker)),
        createXnaOutput(seller.address, 2n * COIN - 5_000_000n),
      ],
      vrefin: [],
      locktime: 0,
    });
    const psbt = buildPSBTFromRawTransaction({
      network: 'xna-test',
      rawUnsignedTransaction: unsigned,
      inputs: [
        { txid: prevTxid, vout: 0, rawTxHex: prev, witnessScript: covenantHex },
        { txid: prevTxid, vout: 1, rawTxHex: prev },
      ],
    });
    const params = {
      psbt,
      signInputs: [
        { address: seller.address, index: 0, sighashTypes: [1] },
        { address: seller.address, index: 1, sighashTypes: [1] },
      ],
      broadcast: false,
    };
    return { prev, prevTxid, unsigned, psbt, params, covenantHex };
  }

  const refusal = (params: unknown, wallet: PsbtWallet) => {
    try {
      inspectSignPsbt(params, wallet, true);
    } catch (error) {
      return error as PsbtRequestError;
    }
    throw new Error('accepted');
  };

  it.each([
    ['P2PKH', legacy],
    ['ECDSA witness v3', ecdsa],
  ])("shows a %s seller's cancellation and signs it as its own signer would", async (_, seller) => {
    const order = cancellation(seller);
    const view = inspectSignPsbt(order.params, walletOf(seller), true);
    expect(view.cancellations).toEqual([
      { index: 0, address: seller.address, locked: { name: 'STAYTOKEN', amount: '7', operation: 'transfer' } },
    ]);
    expect(view.toSign.map(i => i.index)).toEqual([0, 1]);
    expect(view.outputs[0]).toMatchObject({ address: seller.address, ownAddress: true, asset: { name: 'STAYTOKEN', amount: '7' } });

    const signed = await signPsbtWithWallet(order.params, walletOf(seller), true);
    const fromPsbt = extractPsbtTransaction(finalizePsbt(signed)).hex;
    const expected = signTransaction(
      'xna-test',
      order.unsigned,
      [
        {
          address: seller.address,
          assetName: 'STAYTOKEN',
          txid: order.prevTxid,
          outputIndex: 0,
          script: createAssetTransferOutput(covenantAddress(order.covenantHex), 'STAYTOKEN', 7n * COIN, marker).scriptPubKeyHex,
          satoshis: 0,
          value: 0,
          bareScriptHint: { kind: 'covenant-cancel-legacy', covenantScriptHex: order.covenantHex },
        },
        {
          address: seller.address,
          assetName: 'XNA',
          txid: order.prevTxid,
          outputIndex: 1,
          script: scriptOf(fund(seller.address, 1n, 0)),
          satoshis: 2n * COIN,
          value: 2n * COIN,
        },
      ],
      { [seller.address]: seller.WIF },
      { debug: false },
    );
    expect(fromPsbt).toBe(expected);
    expect(finalizeSignedPSBT(order.psbt, signed, 'xna-test').txHex).toBe(expected);
  });

  it('accepts the tokens back at another address of this wallet', () => {
    const order = cancellation(legacy, { refunds: [{ address: legacy2.address, raw: 7n * COIN }] });
    expect(inspectSignPsbt(order.params, walletOf(legacy, legacy2), true).cancellations).toHaveLength(1);
  });

  it('refuses a cancellation whose tokens do not all come back to this wallet', () => {
    const toStranger = cancellation(legacy, { refunds: [{ address: stranger.address, raw: 7n * COIN }] });
    expect(refusal(toStranger.params, walletOf(legacy)).message).toMatch(/holds 7 STAYTOKEN, but not all of it comes back/);
    const split = cancellation(legacy, {
      refunds: [
        { address: legacy.address, raw: 6n * COIN },
        { address: stranger.address, raw: 1n * COIN },
      ],
    });
    expect(refusal(split.params, walletOf(legacy)).message).toMatch(/not all of it comes back/);
  });

  it('refuses an order whose cancel key is not the one of the address named', () => {
    const order = cancellation(legacy);
    const otherKey = { ...order.params, signInputs: [{ address: legacy2.address, index: 0 }] };
    const error = refusal(otherKey, walletOf(legacy, legacy2));
    expect(error.code).toBe(PSBT_ERROR_UNAUTHORIZED);
    expect(error.message).toMatch(/not cancelled with the key of/);
    expect(refusal(order.params, walletOf(legacy2)).code).toBe(PSBT_ERROR_UNAUTHORIZED);
  });

  it('refuses a witnessScript that is not the script of the order, and post-quantum orders', () => {
    const order = cancellation(legacy);
    const other = cancellation(legacy, { covenantHex: orderOf(ecdsa) });
    const mismatched = updatePsbtInput(
      createPsbt({ unsignedTx: order.unsigned, inputs: [{ previousTx: order.prev }, { previousTx: order.prev }] }),
      0,
      {
        witnessScript: other.covenantHex,
      },
    );
    expect(refusal({ ...order.params, psbt: mismatched }, walletOf(legacy)).message).toMatch(/not the script of the output it spends/);

    const pqCovenant = buildPartialFillScriptPQHex({
      paymentAddress: legacy.address,
      pubKeyCommitment: new Uint8Array(32).fill(7),
      tokenId: 'STAYTOKEN',
      unitPriceSats: 1n,
    });
    const pq = cancellation(legacy, { covenantHex: pqCovenant });
    expect(refusal(pq.params, walletOf(legacy)).message).toMatch(/post-quantum key/);
  });

  it('refuses a witness UTXO that contradicts the previous transaction', () => {
    // neurai-create-transaction never writes one; a site could, with any PSBT tool.
    const order = cancellation(legacy);
    const forged = bitcoin.Psbt.fromBase64(order.psbt);
    forged.data.updateInput(0, { witnessUtxo: { script: Buffer.from(scriptOf(fund(legacy.address, 1n, 0)), 'hex'), value: 0n } });
    expect(refusal({ ...order.params, psbt: forged.toBase64() }, walletOf(legacy)).message).toMatch(
      /not a valid PSBT: .*witness UTXO contradicts the previous transaction/,
    );
  });

  it('signs an order funded by a version-3 transaction', async () => {
    const order = cancellation(ecdsa, { prevVersion: 3 });
    expect(inspectSignPsbt(order.params, walletOf(ecdsa), true).cancellations).toHaveLength(1);
    const signed = await signPsbtWithWallet(order.params, walletOf(ecdsa), true);
    expect(extractPsbtTransaction(finalizePsbt(signed)).incomplete).toEqual([]);
  });

  it('refuses to sign over a different signature already in the PSBT for its key', async () => {
    const unsigned = createPaymentTransaction({
      inputs: [{ txid: txid(fundLegacy), vout: 0 }],
      payments: [{ address: stranger.address, valueSats: 490_000n }],
    }).rawTx;
    const stale = bitcoin.script.signature.encode(Buffer.alloc(64, 1), 1);
    const psbt = updatePsbtInput(createPsbt({ unsignedTx: unsigned, inputs: [{ previousTx: fundLegacy }] }), 0, {
      partialSig: [{ pubkeyHex: legacy.publicKey, signatureHex: Buffer.from(stale).toString('hex') }],
    });
    await expect(signPsbtWithWallet({ psbt, signInputs: [{ address: legacy.address, index: 0 }] }, walletOf(legacy), true)).rejects.toThrow(
      /could not be signed: PSBT conflict in input 0: partial signature/,
    );
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
