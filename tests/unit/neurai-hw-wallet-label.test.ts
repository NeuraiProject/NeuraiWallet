import assert from 'assert';

import { HARDWARE_WALLET_TYPE_READABLE, nextHardwareWalletLabel } from '../../blue_modules/neurai-hw/walletLabel';

const base = HARDWARE_WALLET_TYPE_READABLE;

describe('nextHardwareWalletLabel', () => {
  it('uses the plain type name when no hardware wallet exists yet', () => {
    assert.strictEqual(nextHardwareWalletLabel([]), base);
    assert.strictEqual(nextHardwareWalletLabel(['My savings', 'Testnet']), base);
  });

  it('appends the lowest free number once the plain name is taken', () => {
    assert.strictEqual(nextHardwareWalletLabel([base]), `${base} 2`);
    assert.strictEqual(nextHardwareWalletLabel([base, `${base} 2`]), `${base} 3`);
  });

  it('fills a gap left by a renamed or deleted device', () => {
    assert.strictEqual(nextHardwareWalletLabel([base, `${base} 3`]), `${base} 2`);
  });

  it('ignores surrounding whitespace in existing names', () => {
    assert.strictEqual(nextHardwareWalletLabel([`  ${base} `]), `${base} 2`);
  });
});
