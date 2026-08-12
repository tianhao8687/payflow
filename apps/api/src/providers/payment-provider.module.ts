import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PAYMENT_PROVIDER,
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderRegistry,
} from '@payflow/payment-core';
import { PayPalProvider } from '@payflow/payment-paypal';
import { StripeProvider } from '@payflow/payment-stripe';

import type { ApiEnvironment } from '../config/environment';

export const PAYPAL_PAYMENT_PROVIDER = Symbol.for(
  '@payflow/api/PayPalPaymentProvider',
);

@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<ApiEnvironment, true>,
      ): StripeProvider =>
        new StripeProvider({
          appName: 'PayFlow',
          appVersion: '0.10.0',
          secretKey: config.get('STRIPE_SECRET_KEY', { infer: true }),
          webhookSecret: config.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
        }),
    },
    {
      provide: PAYPAL_PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<ApiEnvironment, true>,
      ): PayPalProvider =>
        new PayPalProvider({
          clientId: config.get('PAYPAL_CLIENT_ID', { infer: true }),
          clientSecret: config.get('PAYPAL_CLIENT_SECRET', { infer: true }),
          webhookId: config.get('PAYPAL_WEBHOOK_ID', { infer: true }),
        }),
    },
    {
      provide: PAYMENT_PROVIDER_REGISTRY,
      inject: [PAYMENT_PROVIDER, PAYPAL_PAYMENT_PROVIDER],
      useFactory: (
        stripe: PaymentProvider,
        paypal: PaymentProvider,
      ): PaymentProviderRegistry =>
        new PaymentProviderRegistry([stripe, paypal]),
    },
  ],
  exports: [
    PAYMENT_PROVIDER,
    PAYPAL_PAYMENT_PROVIDER,
    PAYMENT_PROVIDER_REGISTRY,
  ],
})
export class PaymentProviderModule {}
