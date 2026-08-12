import { validateEnvironment } from './environment';

const valid = {
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://payflow:payflow@localhost:5432/payflow',
  JWT_SECRET: 'payflow-test-secret-with-32-characters',
};

describe('environment validation', () => {
  it('allows absent or test Stripe credentials', () => {
    expect(validateEnvironment(valid).STRIPE_SECRET_KEY).toBe('');
    expect(validateEnvironment(valid).STRIPE_WEBHOOK_SECRET).toBe('');
    expect(
      validateEnvironment({
        ...valid,
        STRIPE_SECRET_KEY: 'sk_test_payflow',
        STRIPE_WEBHOOK_SECRET: 'whsec_payflow',
      }).STRIPE_SECRET_KEY,
    ).toBe('sk_test_payflow');
    expect(
      validateEnvironment({
        ...valid,
        STRIPE_WEBHOOK_SECRET: 'whsec_payflow',
      }).STRIPE_WEBHOOK_SECRET,
    ).toBe('whsec_payflow');
  });

  it('rejects live Stripe credentials', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        STRIPE_SECRET_KEY: 'sk_live_forbidden',
      }),
    ).toThrow('live keys are forbidden');
  });

  it('rejects malformed Stripe webhook credentials', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        STRIPE_WEBHOOK_SECRET: 'not-a-webhook-secret',
      }),
    ).toThrow('webhook signing secret');
  });
});
