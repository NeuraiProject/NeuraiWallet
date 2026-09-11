import {
  detectIncomingActivity,
  incomingTxCount,
  otherNetwork,
  resolveNetworkView,
  walletNetwork,
} from '../../blue_modules/neurai/networkSelection';
import type { NeuraiNetwork } from '../../blue_modules/neurai/networkConfig';

const wallet = (id: string, network: NeuraiNetwork | null, values: number[] = []) => ({
  getID: () => id,
  ...(network ? { getNeuraiNetwork: () => network } : {}),
  getTransactions: () => values.map(value => ({ value })),
});

describe('network selection', () => {
  describe('walletNetwork', () => {
    it('reads the network off a Neurai wallet', () => {
      expect(walletNetwork(wallet('a', 'testnet'))).toBe('testnet');
      expect(walletNetwork(wallet('b', 'mainnet'))).toBe('mainnet');
    });

    it('buckets anything else as mainnet so no balance is dropped', () => {
      expect(walletNetwork(wallet('c', null))).toBe('mainnet');
    });
  });

  describe('resolveNetworkView', () => {
    it('honours the pick and allows switching when both networks have wallets', () => {
      const wallets = [wallet('m', 'mainnet'), wallet('t', 'testnet')];
      expect(resolveNetworkView('testnet', wallets)).toEqual({ network: 'testnet', canSwitch: true });
      expect(resolveNetworkView('mainnet', wallets)).toEqual({ network: 'mainnet', canSwitch: true });
    });

    it('shows the only network that has wallets, whatever was picked', () => {
      expect(resolveNetworkView('mainnet', [wallet('t', 'testnet')])).toEqual({ network: 'testnet', canSwitch: false });
      expect(resolveNetworkView('testnet', [wallet('m', 'mainnet')])).toEqual({ network: 'mainnet', canSwitch: false });
    });

    it('falls back to mainnet with no wallets at all', () => {
      expect(resolveNetworkView('testnet', [])).toEqual({ network: 'mainnet', canSwitch: false });
    });
  });

  it('otherNetwork flips', () => {
    expect(otherNetwork('mainnet')).toBe('testnet');
    expect(otherNetwork('testnet')).toBe('mainnet');
  });

  describe('incomingTxCount', () => {
    it('counts only positive values', () => {
      expect(incomingTxCount([{ value: 5 }, { value: -3 }, { value: 0 }, {}, { value: 1 }])).toBe(2);
    });
  });

  describe('detectIncomingActivity', () => {
    it('baselines unseen wallets without reporting them', () => {
      const { next, networksWithNew } = detectIncomingActivity(new Map(), [wallet('t', 'testnet', [10, 20])]);
      expect(next.get('t')).toBe(2);
      expect(networksWithNew.size).toBe(0);
    });

    it('reports the network of a wallet whose incoming count grew', () => {
      const prev = new Map([
        ['t', 1],
        ['m', 3],
      ]);
      const { next, networksWithNew } = detectIncomingActivity(prev, [wallet('t', 'testnet', [10, 20]), wallet('m', 'mainnet', [1, 2, 3])]);
      expect([...networksWithNew]).toEqual(['testnet']);
      expect(next.get('t')).toBe(2);
      expect(next.get('m')).toBe(3);
    });

    it('ignores outgoing transactions and drops removed wallets from the snapshot', () => {
      const prev = new Map([
        ['t', 1],
        ['gone', 4],
      ]);
      const { next, networksWithNew } = detectIncomingActivity(prev, [wallet('t', 'testnet', [10, -50])]);
      expect(networksWithNew.size).toBe(0);
      expect(next.has('gone')).toBe(false);
    });
  });
});
