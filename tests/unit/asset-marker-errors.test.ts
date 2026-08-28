// The two NIP-040 rejections a node can answer with, translated for the user.
//
// The wallet picks the marker from a table, so it can disagree with the node in
// both directions and each one means something different: one is "wait for the
// node", the other is "the app forgot to pass a marker". A bare
// `bad-txns-asset-marker-before-nip040` tells the user neither.
//
// The strings under test come from the node itself, captured on regtest with
// `-nip040height` set above and below the tip.

import { describeBackendError } from '../../class/wallets/abstract-neurai-wallet';

describe('NIP-040 rejections are explained', () => {
  it('a node that has not migrated yet points at syncing, not at a bug', () => {
    const text = describeBackendError({ message: '16: bad-txns-asset-marker-before-nip040' });
    expect(text).toMatch(/has not activated/i);
    expect(text).toMatch(/block 303000/);
    expect(text).toMatch(/syncing/i);
    // The node's own words survive, for bug reports.
    expect(text).toContain('bad-txns-asset-marker-before-nip040');
  });

  it('a node that has migrated points at the app, not at the node', () => {
    const text = describeBackendError({ message: '16: bad-txns-legacy-asset-marker-after-nip040' });
    expect(text).toMatch(/app bug/i);
    expect(text).toMatch(/assetMarker/);
    expect(text).toContain('bad-txns-legacy-asset-marker-after-nip040');
  });

  it('reads the reason out of the WSS error shape too', () => {
    // The WSS backend rejects with no `.message` of its own.
    const text = describeBackendError({
      status: 500,
      error: { code: -26, message: '16: bad-txns-asset-marker-before-nip040' },
    });
    expect(text).toMatch(/has not activated/i);
  });

  it('leaves every other rejection untouched', () => {
    const text = describeBackendError({ message: '16: bad-txns-inputs-missingorspent' });
    expect(text).toBe('message=16: bad-txns-inputs-missingorspent');
  });
});
