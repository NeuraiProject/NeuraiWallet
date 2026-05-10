import assert from 'assert';

import { _setExchangeRate, _setPreferredFiatCurrency, _setSkipUpdateExchangeRate } from '../../blue_modules/currency';
import { _leaveNumbersAndDots, formatBalance, formatBalancePlain, formatBalanceWithoutSuffix } from '../../loc';
import { XnaUnit } from '../../models/xnaUnits';
import { FiatUnit } from '../../models/fiatUnit';

describe('Localization', () => {
  it('internal formatter', () => {
    assert.strictEqual(_leaveNumbersAndDots('1,00 ₽'), '1');
    assert.strictEqual(_leaveNumbersAndDots('0,50 ₽"'), '0.50');
    assert.strictEqual(_leaveNumbersAndDots('RUB 1,00'), '1');
  });

  it('formatBalancePlain() && formatBalancePlain()', () => {
    _setExchangeRate('XNA_RUB', 660180.143);
    _setPreferredFiatCurrency(FiatUnit.RUB);
    let newInputValue = formatBalanceWithoutSuffix(152, XnaUnit.LOCAL_CURRENCY, false);
    assert.ok(newInputValue === 'RUB 1.00' || newInputValue === '1,00 ₽', 'Unexpected: ' + newInputValue);
    newInputValue = formatBalancePlain(152, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '1');

    newInputValue = formatBalanceWithoutSuffix(1515, XnaUnit.LOCAL_CURRENCY, false);
    assert.ok(newInputValue === 'RUB 10.00' || newInputValue === '10,00 ₽', 'Unexpected: ' + newInputValue);
    newInputValue = formatBalancePlain(1515, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '10');

    newInputValue = formatBalanceWithoutSuffix(16793829, XnaUnit.LOCAL_CURRENCY, false);
    assert.ok(newInputValue === 'RUB 110,869.52' || newInputValue === '110 869,52 ₽', 'Unexpected: ' + newInputValue);
    newInputValue = formatBalancePlain(16793829, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '110869.52');

    newInputValue = formatBalancePlain(76, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '0.50');

    _setExchangeRate('XNA_USD', 10000);
    _setPreferredFiatCurrency(FiatUnit.USD);
    newInputValue = formatBalanceWithoutSuffix(16793829, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '$1,679.38');
    newInputValue = formatBalancePlain(16793829, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '1679.38');

    newInputValue = formatBalancePlain(16000000, XnaUnit.LOCAL_CURRENCY, false);
    assert.strictEqual(newInputValue, '1600');
  });

  it.each([
    [123000000, XnaUnit.SATS, false, '123000000', false],
    [123000000, XnaUnit.SATS, true, '123,000,000', false],
    [123456000, XnaUnit.XNA, true, '1.23456', false],
    ['123456000', XnaUnit.XNA, true, '1.23456', false], // can handle strings
    [100000000, XnaUnit.XNA, true, '1', false],
    [10000000, XnaUnit.XNA, true, '0.1', false],
    [1, XnaUnit.XNA, true, '0.00000001', false],
    [10000000, XnaUnit.LOCAL_CURRENCY, true, '...', true], // means unknown since we did not receive exchange rate
  ])(
    'can formatBalanceWithoutSuffix',
    async (balance, toUnit, withFormatting, expectedResult, shouldResetRate) => {
      _setExchangeRate('XNA_USD', 1);
      _setPreferredFiatCurrency(FiatUnit.USD);
      if (shouldResetRate) {
        _setExchangeRate('XNA_USD', false);
        _setSkipUpdateExchangeRate();
      }
      const actualResult = formatBalanceWithoutSuffix(balance, toUnit, withFormatting);
      assert.strictEqual(actualResult, expectedResult);
    },
    240000,
  );

  it.each([
    [123000000, XnaUnit.SATS, false, '123000000 sats'],
    [123000000, XnaUnit.XNA, false, '1.23 XNA'],
    [15, XnaUnit.XNA, false, '0.00000015 XNA'],
    [1, XnaUnit.XNA, false, '0.00000001 XNA'],
    [0, XnaUnit.XNA, false, '0 XNA'],
    [123000000, XnaUnit.LOCAL_CURRENCY, false, '$1.23'],
  ])(
    'can formatBalance',
    async (balance, toUnit, withFormatting, expectedResult) => {
      _setExchangeRate('XNA_USD', 1);
      _setPreferredFiatCurrency(FiatUnit.USD);
      const actualResult = formatBalance(balance, toUnit, withFormatting);
      assert.strictEqual(actualResult, expectedResult);
    },
    240000,
  );
});
