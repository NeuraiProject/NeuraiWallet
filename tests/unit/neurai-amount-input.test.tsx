import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AmountInput } from '../../components/AmountInput';
import { XnaUnit } from '../../models/xnaUnits';
import { fiatToXNA, _setExchangeRate } from '../../blue_modules/currency';

jest.mock('../../components/themes', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../../blue_modules/currency', () => ({
  ...jest.requireActual('../../blue_modules/currency'),
  isRateOutdated: jest.fn(async () => false),
}));

test.each([
  [XnaUnit.XNA, '100000000.00000001', XnaUnit.SATS, '10000000000000001'],
  [XnaUnit.LOCAL_CURRENCY, '1', XnaUnit.XNA, '0.33333333'],
] as const)('changes %s units without rounding the satoshi amount', (unit, amount, nextUnit, expected) => {
  const onChange = jest.fn();
  const onUnit = jest.fn();
  // Deterministic fiat fixture: $3 / XNA. The conversion truncates fractional sats.
  _setExchangeRate('XNA_USD', 3);
  const view = render(<AmountInput amount={amount} unit={unit} onChangeText={onChange} onAmountUnitChange={onUnit} />);
  expect(view.getByTestId('BitcoinAmountInput').props.value).toBe(amount);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  expect(onChange).toHaveBeenCalledWith(expected);
  expect(onUnit).toHaveBeenCalledWith(nextUnit);
});

it('truncates fiat conversion at one satoshi', () => {
  _setExchangeRate('XNA_USD', 3);
  expect(fiatToXNA('1')).toBe('0.33333333');
});

it('preserves pasted satoshis above 2^53 while editing', () => {
  _setExchangeRate('XNA_USD', 3);
  const onChange = jest.fn();
  const view = render(<AmountInput amount="0" unit={XnaUnit.SATS} onChangeText={onChange} onAmountUnitChange={jest.fn()} />);
  fireEvent.changeText(view.getByTestId('BitcoinAmountInput'), '10000000000000001');
  expect(onChange).toHaveBeenLastCalledWith('10000000000000001');
  fireEvent.changeText(view.getByTestId('BitcoinAmountInput'), '00010000000000000001');
  expect(onChange).toHaveBeenLastCalledWith('10000000000000001');
});
