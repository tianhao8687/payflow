import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from '@payflow/payment-core';
import { StripeProvider } from '@payflow/payment-stripe';

import type { ApiEnvironment } from '../config/environment';

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
          appVersion: '0.7.0',
          secretKey: config.get('STRIPE_SECRET_KEY', { infer: true }),
          webhookSecret: config.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
        }),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
