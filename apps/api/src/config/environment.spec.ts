import { validateEnvironment } from './environment';

const valid = {
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://payflow:payflow@localhost:5432/payflow',
  JWT_SECRET: 'payflow-test-secret-with-32-characters',
};

describe('environment validation', () => {
  it('allows an absent or test Stripe key', () => {
    expect(validateEnvironment(valid).STRIPE_SECRET_KEY).toBe('');
    expect(
      validateEnvironment({
        ...valid,
        STRIPE_SECRET_KEY: 'sk_test_payflow',
      }).STRIPE_SECRET_KEY,
    ).toBe('sk_test_payflow');
  });

  it('rejects live Stripe credentials', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        STRIPE_SECRET_KEY: 'sk_live_forbidden',
      }),
    ).toThrow('live keys are forbidden');
  });
});
