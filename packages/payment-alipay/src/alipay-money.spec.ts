import {
  alipayAmountToMinorUnits,
  minorUnitsToAlipayAmount,
} from './alipay-money';

describe('Alipay CNY amount conversion', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [99, '0.99'],
    [100, '1.00'],
    [12_345, '123.45'],
    [2_147_483_647, '21474836.47'],
  ])('converts %i minor units to %s without floating point', (minor, value) => {
    expect(minorUnitsToAlipayAmount(minor)).toBe(value);
    expect(alipayAmountToMinorUnits(value)).toBe(minor);
  });

  it.each([-1, 1.2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid minor amount %s',
    (amount) => {
      expect(() => minorUnitsToAlipayAmount(amount)).toThrow();
    },
  );

  it.each(['1', '1.0', '01.00', '1.000', '-1.00', 'NaN'])(
    'rejects a non-canonical provider amount %s',
    (value) => {
      expect(() => alipayAmountToMinorUnits(value)).toThrow();
    },
  );
});
