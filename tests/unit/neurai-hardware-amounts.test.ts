import { Transaction, Psbt } from 'bitcoinjs-lib';
import { NeuraiESP32, INeuraiTransport, encodeDestinationScript } from '@neuraiproject/neurai-sign-esp32/react-native';
import { NeuraiHardwareWallet } from '../../class/wallets/neurai-hardware-wallet';
import { NeuraiPQWallet } from '../../class/wallets/neurai-pq-wallet';
import { deriveLegacyAddress } from '../../blue_modules/neurai-hw/xpubDerivation';
import { RpcBackend } from '../../blue_modules/neurai/RpcBackend';

const xpub = 'xpub661MyMwAqRbcGmUDQVKxmhEESB5xTk8hbsdTSV3Pmhm3HE9Fj3s45R9Y8LwyaQWjXXPytZjuhTKSyCBPeNrB1VVWQq1HCvjbEZ27k44oNmg';
const recipient = deriveLegacyAddress(xpub, 'xna-test', 0, 9).address;

function fixture(amount: bigint, keyType: 'legacy' | 'pq' = 'legacy', address?: string) {
  const wallet = new NeuraiHardwareWallet();
  wallet.keyType = keyType;
  wallet.network = keyType === 'legacy' ? 'xna-test' : 'xna-pq-test';
  wallet.xpub = keyType === 'legacy' ? xpub : '';
  wallet.accountPath = "m/44'/1'/0'";
  wallet.hwFingerprint = '168dd603';
  wallet.address = address ?? deriveLegacyAddress(xpub, 'xna-test', 0, 0).address;
  const previous = new Transaction();
  previous.addInput(Buffer.alloc(32, 1), 0);
  previous.addOutput(encodeDestinationScript(wallet.address), amount);
  const utxo = {
    address: wallet.address,
    txid: previous.getId(),
    outputIndex: 0,
    satoshis: amount.toString(),
    assetName: 'XNA',
    script: Buffer.from(previous.outs[0].script).toString('hex'),
  };
  const backend = new RpcBackend({
    chain: wallet.network,
    url: 'http://127.0.0.1:19211',
  });
  const rpc = jest.spyOn(backend, 'rpc').mockImplementation(async method => {
    if (method === 'getaddressutxos') return [utxo];
    if (method === 'getaddressmempool') return [];
    if (method === 'getrawtransaction') return previous.toHex();
    throw new Error('Unexpected RPC: ' + method);
  });
  jest.spyOn(backend, 'getAddressHistory').mockResolvedValue([]);
  wallet.setBackend(backend);
  return { wallet, previous, rpc, utxo };
}

// Exercise the real SDK's JSON boundary, without pretending to sign in firmware.
function recordingDevice() {
  const sendCommandHeartbeat = jest.fn(async (_command: Record<string, unknown>) => {
    throw new Error('transport capture complete');
  });
  const transport: INeuraiTransport = {
    connected: true,
    open: async () => {},
    close: async () => {},
    sendCommand: async () => ({ status: 'ok', device: 'NeuraiHW' }) as Awaited<ReturnType<INeuraiTransport['sendCommand']>>,
    sendCommandFinal: sendCommandHeartbeat,
    sendCommandHeartbeat,
  };
  return { device: new NeuraiESP32({ transport }), sendCommandHeartbeat };
}

test.each([false, true])('builds a legacy PSBT with exact odd large prevout and outputs (sendMax=%s)', async sendMax => {
  const total = 10000000000000001n;
  const { wallet, previous } = fixture(total);
  const result = await wallet.buildUnsignedSend(recipient, 100000000n, {
    feeRate: 1,
    sendMax,
  });
  const psbt = Psbt.fromBase64(result.psbtBase64!);
  expect(Transaction.fromBuffer(psbt.data.inputs[0].nonWitnessUtxo!).outs[0].value).toBe(total);
  expect(Buffer.from(psbt.txInputs[0].hash)).toEqual(Buffer.from(previous.getHash()));
  expect(psbt.txOutputs[0].value).toBe(result.amountSats);
  expect(psbt.txOutputs.reduce((sum, o) => sum + o.value, result.feeSats)).toBe(total);
  if (sendMax) expect(result.amountSats).toBeGreaterThan(9007199254740991n);
  else expect(psbt.txOutputs[1].value).toBe(total - result.amountSats - result.feeSats);
});

test.each([false, true])('builds and transports exact large PQ amounts (sendMax=%s)', async sendMax => {
  const software = NeuraiPQWallet.forNetwork('testnet', 'result pact model attract result puzzle final boss private educate luggage era');
  const address = await software.getReceiveAddressAsync();
  const total = 10000000000000001n;
  const { wallet, utxo } = fixture(total, 'pq', address);
  const result = await wallet.buildUnsignedSend(recipient, 100000001n, {
    feeRate: 1,
    sendMax,
  });
  expect(result.inputs![0].amount).toBe(total.toString());
  const tx = Transaction.fromHex(result.rawTxHex!);
  expect(tx.outs[0].value).toBe(result.amountSats);
  expect(tx.outs.reduce((sum, out) => sum + out.value, result.feeSats)).toBe(total);
  if (sendMax) expect(result.amountSats).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  const { device, sendCommandHeartbeat } = recordingDevice();
  await expect(wallet.signWithDevice(device, result)).rejects.toThrow('transport capture complete');
  const command = JSON.parse(JSON.stringify(sendCommandHeartbeat.mock.calls[0][0]));
  expect(command.action).toBe('sign_tx');
  expect(command.tx).toBe(result.rawTxHex);
  expect(command.inputs).toEqual([{ index: 0, amount: total.toString(), script_pub_key: utxo.script }]);
});

it('builds safe PQ signing metadata and conserves every satoshi', async () => {
  const software = NeuraiPQWallet.forNetwork('testnet', 'result pact model attract result puzzle final boss private educate luggage era');
  const address = await software.getReceiveAddressAsync();
  const total = 9007199254740991n;
  const { wallet, utxo } = fixture(total, 'pq', address);
  const result = await wallet.buildUnsignedSend(recipient, 100000001n, {
    feeRate: 1,
  });
  expect(result.inputs![0].amount).toBe(total.toString());
  const { device, sendCommandHeartbeat } = recordingDevice();
  await expect(wallet.signWithDevice(device, result)).rejects.toThrow('transport capture complete');
  const command = JSON.parse(JSON.stringify(sendCommandHeartbeat.mock.calls[0][0]));
  expect(command.inputs[0].amount).toBe(Number.MAX_SAFE_INTEGER);
  expect(result.inputs![0].script_pub_key).toBe(utxo.script);
  const tx = Transaction.fromHex(result.rawTxHex!);
  expect(tx.outs[0].value).toBe(100000001n);
  expect(tx.outs.reduce((sum, out) => sum + out.value, result.feeSats)).toBe(total);
});

it('excludes pending spends and propagates mempool failures before building', async () => {
  const { wallet, rpc, utxo } = fixture(100000000n);
  rpc.mockImplementation(async method => {
    if (method === 'getaddressutxos') return [utxo];
    if (method === 'getaddressmempool') return [{ prevtxid: utxo.txid, prevout: 0 }];
    throw new Error('Unexpected');
  });
  await expect(wallet.buildUnsignedSend(recipient, 1n, { feeRate: 1 })).rejects.toThrow('No spendable');
  rpc.mockRejectedValue(new Error('Node unavailable'));
  await expect(wallet.buildUnsignedSend(recipient, 1n, { feeRate: 1 })).rejects.toThrow('Node unavailable');
});

it('accounts for a one-satoshi dust change in the exact fee', async () => {
  const { wallet } = fixture(100000227n);
  const result = await wallet.buildUnsignedSend(recipient, 100000000n, {
    feeRate: 1,
  });
  const psbt = Psbt.fromBase64(result.psbtBase64!);
  expect(psbt.txOutputs).toHaveLength(1);
  expect(psbt.txOutputs[0].value).toBe(100000000n);
  expect(result.feeSats).toBe(227n);
});

it('keeps asset sighash amounts zero and large XNA fees inputs exact through the SDK', async () => {
  const software = NeuraiPQWallet.forNetwork('testnet', 'result pact model attract result puzzle final boss private educate luggage era');
  const address = await software.getReceiveAddressAsync();
  const total = 10000000000000001n;
  const { wallet, rpc, utxo } = fixture(total, 'pq', address);
  jest.spyOn(wallet, 'estimateFeeRate').mockResolvedValue(0.01);
  rpc.mockImplementation(async method => {
    if (method === 'getaddressutxos') {
      return [
        utxo,
        {
          ...utxo,
          txid: '02'.repeat(32),
          assetName: 'LARGE',
          satoshis: total.toString(),
        },
      ];
    }
    if (method === 'getaddressmempool') return [];
    throw new Error('Unexpected RPC: ' + method);
  });
  const result = await wallet.buildUnsignedAssetSend(recipient, 'LARGE', '100000000.00000001');
  expect(result.inputs!.map(input => input.amount)).toEqual([0, total.toString()]);
  const tx = Transaction.fromHex(result.rawTxHex!);
  expect(tx.outs.reduce((sum, out) => sum + out.value, result.feeSats)).toBe(total);
  const { device, sendCommandHeartbeat } = recordingDevice();
  await expect(wallet.signWithDevice(device, result)).rejects.toThrow('transport capture complete');
  const command = JSON.parse(JSON.stringify(sendCommandHeartbeat.mock.calls[0][0]));
  expect(command.inputs.map((input: { amount: string | number }) => input.amount)).toEqual([0, total.toString()]);
  expect(JSON.stringify(command.display)).toContain('100000000.00000001');
});

it('rejects already rounded amounts before sending a signing command', async () => {
  const { device, sendCommandHeartbeat } = recordingDevice();
  await expect(
    device.signPqRawTransaction({
      txHex: '',
      inputs: [{ index: 0, amount: Number('10000000000000001'), script_pub_key: '' }],
    }),
  ).rejects.toThrow();
  expect(sendCommandHeartbeat).not.toHaveBeenCalled();
});
