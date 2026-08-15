import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlipayProvider } from '@payflow/payment-alipay';
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
export const ALIPAY_PAYMENT_PROVIDER = Symbol.for(
  '@payflow/api/AlipayPaymentProvider',
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
          appVersion: '0.11.0',
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
      provide: ALIPAY_PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<ApiEnvironment, true>,
      ): AlipayProvider =>
        new AlipayProvider({
          allowProduction: config.get('ALIPAY_ALLOW_PRODUCTION', {
            infer: true,
          }),
          alipayPublicCertContent: config.get(
            'ALIPAY_ALIPAY_PUBLIC_CERT_CONTENT',
            { infer: true },
          ),
          alipayPublicKey: config.get('ALIPAY_PUBLIC_KEY', { infer: true }),
          alipayRootCertContent: config.get('ALIPAY_ALIPAY_ROOT_CERT_CONTENT', {
            infer: true,
          }),
          appCertContent: config.get('ALIPAY_APP_CERT_CONTENT', {
            infer: true,
          }),
          appId: config.get('ALIPAY_APP_ID', { infer: true }),
          enabled: config.get('ALIPAY_ENABLED', { infer: true }),
          environment: config.get('ALIPAY_ENV', { infer: true }),
          gatewayUrl: config.get('ALIPAY_GATEWAY_URL', { infer: true }),
          notifyUrl: config.get('ALIPAY_NOTIFY_URL', { infer: true }),
          privateKey: config.get('ALIPAY_APP_PRIVATE_KEY', { infer: true }),
          returnUrl: config.get('ALIPAY_RETURN_URL', { infer: true }),
          sellerId: config.get('ALIPAY_SELLER_ID', { infer: true }),
        }),
    },
    {
      provide: PAYMENT_PROVIDER_REGISTRY,
      inject: [
        PAYMENT_PROVIDER,
        PAYPAL_PAYMENT_PROVIDER,
        ALIPAY_PAYMENT_PROVIDER,
      ],
      useFactory: (
        stripe: PaymentProvider,
        paypal: PaymentProvider,
        alipay: PaymentProvider,
      ): PaymentProviderRegistry =>
        new PaymentProviderRegistry([stripe, paypal, alipay]),
    },
  ],
  exports: [
    PAYMENT_PROVIDER,
    PAYPAL_PAYMENT_PROVIDER,
    ALIPAY_PAYMENT_PROVIDER,
    PAYMENT_PROVIDER_REGISTRY,
  ],
})
export class PaymentProviderModule {}
