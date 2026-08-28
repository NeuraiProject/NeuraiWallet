import { markerForChain } from '../../blue_modules/neurai/assetMarker';
import type { NeuraiChainType } from '../../blue_modules/neurai/networkConfig';

// The marker decides whether an asset transaction is accepted at all: a chain
// past NIP-040 activation rejects `rvn` with
// bad-txns-legacy-asset-marker-after-nip040, and a chain before it rejects
// `xna`. There is no safe default, which is what these tests pin.

describe('markerForChain', () => {
  it('mainnet chains use the legacy marker', () => {
    expect(markerForChain('xna')).toBe('rvn');
    expect(markerForChain('xna-pq')).toBe('rvn');
  });

  it('testnet chains use the migrated marker', () => {
    expect(markerForChain('xna-test')).toBe('xna');
    expect(markerForChain('xna-pq-test')).toBe('xna');
  });

  it('covers every supported chain', () => {
    const all: NeuraiChainType[] = ['xna', 'xna-pq', 'xna-test', 'xna-pq-test'];
    for (const chain of all) expect(['rvn', 'xna']).toContain(markerForChain(chain));
  });

  it('throws on an unknown chain instead of defaulting', () => {
    // A default would be a guess: `xna` builds transactions mainnet rejects,
    // `rvn` builds transactions testnet rejects.
    expect(() => markerForChain('xna-future' as NeuraiChainType)).toThrow(/Unknown chain/);
    expect(() => markerForChain(undefined as unknown as NeuraiChainType)).toThrow(/Unknown chain/);
  });

  it('no mainnet chain ever returns xna', () => {
    // Guards against a careless edit to the table.
    for (const chain of ['xna', 'xna-pq'] as NeuraiChainType[]) {
      expect(markerForChain(chain)).not.toBe('xna');
    }
  });
});
