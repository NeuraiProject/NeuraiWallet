import { createStandardAssetTransferTransaction } from '@neuraiproject/neurai-create-transaction';

import { markerForChain } from '../../blue_modules/neurai/assetMarker';
import type { NeuraiChainType } from '../../blue_modules/neurai/networkConfig';

// The three local asset builds in the app (the software manual fallback and
// the two hardware paths) all go through this one library call. Omitting
// `assetMarker` is NOT a compile error: the library keeps `rvn` and the chain
// rejects the transaction with bad-txns-legacy-asset-marker-after-nip040.
// These tests pin that the marker actually reaches the serialized bytes.

const RVN_HEX = Buffer.from('rvn', 'ascii').toString('hex'); // 72766e
const XNA_HEX = Buffer.from('xna', 'ascii').toString('hex'); // 786e61
const ADDRESS = 'tEsoJrjTfB8SrJS5CngFNbX5vmaQ8aN6QH';

const buildFor = (chain: NeuraiChainType) =>
  createStandardAssetTransferTransaction({
    // Same shape the app passes: TxInput carries only txid/vout.
    inputs: [
      { txid: 'aa'.repeat(32), vout: 0 },
      { txid: 'bb'.repeat(32), vout: 0 },
    ],
    // XNA change travels as a payment, exactly as the app builds it.
    payments: [{ address: ADDRESS, valueSats: 50_000_000n }],
    transfers: [{ address: ADDRESS, assetName: 'BUTTER', amountRaw: 100_000_000n }],
    assetMarker: markerForChain(chain),
  }).rawTx;

describe('the marker reaches the serialized asset output', () => {
  it('testnet builds carry xna', () => {
    for (const chain of ['xna-test', 'xna-pq-test'] as NeuraiChainType[]) {
      const raw = buildFor(chain);
      expect(raw).toContain(XNA_HEX);
      expect(raw).not.toContain(RVN_HEX);
    }
  });

  it('mainnet builds carry rvn', () => {
    for (const chain of ['xna', 'xna-pq'] as NeuraiChainType[]) {
      const raw = buildFor(chain);
      expect(raw).toContain(RVN_HEX);
      expect(raw).not.toContain(XNA_HEX);
    }
  });

  it('omitting the marker silently falls back to rvn', () => {
    // Documents WHY every call site must pass it: there is no error to catch.
    const raw = createStandardAssetTransferTransaction({
      inputs: [{ txid: 'aa'.repeat(32), vout: 0 }],
      payments: [{ address: ADDRESS, valueSats: 50_000_000n }],
      transfers: [{ address: ADDRESS, assetName: 'BUTTER', amountRaw: 100_000_000n }],
    }).rawTx;
    expect(raw).toContain(RVN_HEX);
  });
});
