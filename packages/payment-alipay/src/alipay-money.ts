const alipayAmountPattern = /^(0|[1-9]\d*)\.(\d{2})$/;

export function minorUnitsToAlipayAmount(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Alipay amount must be a non-negative safe integer.');
  }
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

export function alipayAmountToMinorUnits(value: string): number {
  const match = alipayAmountPattern.exec(value);
  if (!match) {
    throw new Error('Alipay returned an invalid CNY decimal amount.');
  }
  const amount = BigInt(match[1]!) * 100n + BigInt(match[2]!);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Alipay amount exceeds the safe integer range.');
  }
  return Number(amount);
}
