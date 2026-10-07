// The C6 deposit first creates an exact funding coin by paying the wallet
// itself. A PQ wallet that reuses its address keeps its change there, so the
// coin must go to another own address: the transaction builder refuses a
// change address equal to a recipient.

import assert from 'assert';
import { bech32m } from 'bech32';
import * as bitcoin from 'bitcoinjs-lib';
import { c6FundingAddresses } from '../../blue_modules/neurai/privacy/wallet';
import { NeuraiHDWallet } from '../../class/wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';

const KNOWN_MNEMONIC = 'result pact model attract result puzzle final boss private educate luggage era';

/** scriptPubKey of a witness address (`OP_n <program>`). */
function scriptOf(address: string): string {
  const { words } = bech32m.decode(address, 200);
  const program = Buffer.from(bech32m.fromWords(words.slice(1)));
  return Buffer.from([0x50 + words[0], program.length]).toString('hex') + program.toString('hex');
}

/** A testnet PQ wallet holding one 5 XNA coin on its first (reused) address. */
async function fundedPQWallet() {
  const wallet = NeuraiPQWallet.forNetwork('testnet', KNOWN_MNEMONIC);
  const [reused] = await wallet.listOwnAddresses();
  const rpc = jest.fn(async (method: string) => {
    if (method === 'getaddressutxos') {
      return [
        {
          address: reused,
          assetName: 'XNA',
          txid: 'cd'.repeat(32),
          outputIndex: 0,
          script: scriptOf(reused),
          satoshis: 500_000_000,
          height: 100,
        },
      ];
    }
    if (method === 'getaddressmempool') return [];
    if (method === 'gettxout') return { value: 5, scriptPubKey: { hex: scriptOf(reused) } };
    throw new Error(`unexpected rpc ${method}`);
  });
  jest.spyOn(wallet, 'getBackend').mockReturnValue({ chain: wallet.network, rpc } as never);
  return { wallet, reused };
}

describe('C6 funding coin of a PQ wallet that reuses its address', () => {
  it('cannot be paid to the reused address itself', async () => {
    const { wallet, reused } = await fundedPQWallet();
    await expect(wallet.buildSendTransaction([{ address: reused, amount: '1.0001' }])).rejects.toThrow(
      'Change address cannot be the same as to address',
    );
  }, 60_000);

  it('goes to another own address while the change stays on the reused one', async () => {
    const { wallet, reused } = await fundedPQWallet();
    const { to, change } = await c6FundingAddresses(wallet, true);
    assert.strictEqual(change, reused);
    assert.ok(to && to !== reused && (await wallet.listOwnAddresses()).includes(to));

    const built = await wallet.buildSendTransaction([{ address: to!, amount: '1.0001' }], { forcedChangeAddress: change });
    const outputs = bitcoin.Transaction.fromHex(built.signedHex).outs.map(out => ({
      script: Buffer.from(out.script).toString('hex'),
      value: BigInt(out.value),
    }));
    assert.deepStrictEqual(
      outputs.find(out => out.script === scriptOf(to!)),
      { script: scriptOf(to!), value: 100_010_000n },
      'exact funding coin on the other own address',
    );
    assert.ok(
      outputs.some(out => out.script === scriptOf(reused)),
      'change back on the reused address',
    );
    assert.strictEqual(outputs.length, 2);
  }, 60_000);
});

describe('C6 funding coin of a legacy wallet', () => {
  it('still goes to the first receive address, with the change on the change branch', async () => {
    const wallet = NeuraiHDWallet.forNetwork('testnet', KNOWN_MNEMONIC);
    const own = await wallet.listOwnAddresses();
    const { to, change } = await c6FundingAddresses(wallet, true);
    assert.strictEqual(to, own[0]);
    assert.strictEqual(change, own[1]);
  }, 60_000);
});
