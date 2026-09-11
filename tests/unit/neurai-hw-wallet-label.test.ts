import assert from 'assert';

import { HARDWARE_WALLET_LABEL_BASE, defaultHardwareWalletLabel } from '../../blue_modules/neurai-hw/walletLabel';

const base = HARDWARE_WALLET_LABEL_BASE;

describe('defaultHardwareWalletLabel', () => {
  it('names the device after its master fingerprint', () => {
    assert.strictEqual(defaultHardwareWalletLabel('a1b2c3d4', []), `${base} (a1b2c3d4)`);
    // Existing names are irrelevant: the fingerprint already makes it unique.
    assert.strictEqual(defaultHardwareWalletLabel('a1b2c3d4', [`${base} (a1b2c3d4)`]), `${base} (a1b2c3d4)`);
  });

  it('normalises the fingerprint to trimmed lower-case hex', () => {
    assert.strictEqual(defaultHardwareWalletLabel(' A1B2C3D4 ', []), `${base} (a1b2c3d4)`);
  });

  it('falls back to the plain base name when the device reports no fingerprint', () => {
    assert.strictEqual(defaultHardwareWalletLabel('', []), base);
    assert.strictEqual(defaultHardwareWalletLabel('  ', ['My savings']), base);
  });

  it('numbers the fallback name so it never collides', () => {
    assert.strictEqual(defaultHardwareWalletLabel('', [base]), `${base} 2`);
    assert.strictEqual(defaultHardwareWalletLabel('', [base, `${base} 2`]), `${base} 3`);
    assert.strictEqual(defaultHardwareWalletLabel('', [base, `${base} 3`]), `${base} 2`);
  });
});
