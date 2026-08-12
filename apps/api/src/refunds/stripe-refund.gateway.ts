import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundStatus } from '@payflow/database';
import Stripe from 'stripe';

import type { ApiEnvironment } from '../config/environment';

export interface CreateStripeRefundInput {
  amount: number;
  idempotencyKey: string;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  refundId: string;
  refundRequestId: string;
}

export interface StripeRefundResult {
  amount: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  providerPaymentId: string | null;
  providerRefundId: string;
  requestId: string | null;
  status: RefundStatus;
}

export class StripeRefundGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'StripeRefundGatewayError';
  }
}

@Injectable()
export class StripeRefundGateway {
  private readonly stripe: Stripe | null;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    const secretKey = config.get('STRIPE_SECRET_KEY', { infer: true });

    this.stripe = secretKey
      ? new Stripe(secretKey, {
          appInfo: { name: 'PayFlow', version: '0.5.0' },
          maxNetworkRetries: 2,
          telemetry: false,
          timeout: 20_000,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.stripe !== null;
  }

  async createRefund(
    input: CreateStripeRefundInput,
  ): Promise<StripeRefundResult> {
    if (!this.stripe) {
      throw new StripeRefundGatewayError(
        'STRIPE_NOT_CONFIGURED',
        'Stripe test mode is not configured.',
      );
    }

    try {
      const refund = await this.stripe.refunds.create(
        {
          amount: input.amount,
          metadata: {
            orderId: input.orderId,
            paymentId: input.paymentId,
            refundId: input.refundId,
            refundRequestId: input.refundRequestId,
          },
          payment_intent: input.providerPaymentId,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      const status = this.mapStatus(refund.status);

      return {
        amount: refund.amount,
        currency: refund.currency.toUpperCase(),
        failureCode:
          status === RefundStatus.FAILED
            ? (refund.failure_reason ?? refund.status ?? 'failed')
            : null,
        failureMessage:
          status === RefundStatus.FAILED
            ? 'Stripe reported that the refund failed or was canceled.'
            : null,
        providerPaymentId: this.expandableId(refund.payment_intent),
        providerRefundId: refund.id,
        requestId: refund.lastResponse?.requestId ?? null,
        status,
      };
    } catch (error: unknown) {
      if (error instanceof StripeRefundGatewayError) {
        throw error;
      }

      if (error instanceof Stripe.errors.StripeError) {
        throw new StripeRefundGatewayError(
          error.code ?? error.type,
          error.message,
          error.requestId ?? null,
          this.isOutcomeUnknown(error.type),
        );
      }

      throw new StripeRefundGatewayError(
        'STRIPE_REFUND_REQUEST_FAILED',
        'Stripe Refund request failed before a verified response arrived.',
        null,
        true,
      );
    }
  }

  private mapStatus(status: string | null): RefundStatus {
    if (status === 'succeeded') {
      return RefundStatus.SUCCEEDED;
    }

    if (status === 'failed' || status === 'canceled') {
      return RefundStatus.FAILED;
    }

    if (status === 'pending' || status === 'requires_action') {
      return RefundStatus.PENDING;
    }

    throw new StripeRefundGatewayError(
      'STRIPE_REFUND_STATUS_UNKNOWN',
      'Stripe returned an unsupported refund status.',
      null,
      true,
    );
  }

  private expandableId(value: string | { id: string } | null): string | null {
    if (typeof value === 'string') {
      return value;
    }

    return value?.id ?? null;
  }

  private isOutcomeUnknown(type: string): boolean {
    return new Set([
      'StripeAPIError',
      'StripeConnectionError',
      'StripeIdempotencyError',
      'StripeRateLimitError',
    ]).has(type);
  }
}
