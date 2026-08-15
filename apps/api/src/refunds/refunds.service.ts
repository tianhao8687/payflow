import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PaymentProvider as DatabasePaymentProvider,
  RefundStatus,
} from '@payflow/database';
import {
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
  PaymentProviderRegistry,
  ProviderRefundStatus,
} from '@payflow/payment-core';
import {
  enrichCorrelation,
  recordRefundFailure,
  setActiveSpanAttributes,
  SpanKind,
  withSpan,
} from '@payflow/observability';

import type { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import {
  CreateRefundResponseDto,
  RefundResponseDto,
} from './dto/refund-response.dto';
import {
  RefundsRepository,
  type RefundWithPayment,
} from './refunds.repository';

@Injectable()
export class RefundsService {
  constructor(
    private readonly refundsRepository: RefundsRepository,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly providers: PaymentProviderRegistry | PaymentProvider,
  ) {}

  async create(
    paymentId: string,
    actorId: string,
    request: CreateRefundRequestDto,
  ): Promise<CreateRefundResponseDto> {
    const providerName =
      await this.refundsRepository.findPaymentProvider(paymentId);
    if (!providerName) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found.',
      });
    }
    const paymentProvider = this.providerFor(providerName);
    enrichCorrelation({ paymentId, provider: providerName });
    setActiveSpanAttributes({
      'payment.provider': providerName,
      'payflow.payment.id': paymentId,
    });

    if (!paymentProvider) {
      throw new ServiceUnavailableException({
        code: 'REFUND_PROVIDER_UNSUPPORTED',
        details: { provider: providerName },
        message: 'The payment provider is not enabled locally.',
      });
    }

    if (!paymentProvider.isConfigured(PaymentProviderCapability.REFUND)) {
      throw new ServiceUnavailableException({
        code: 'REFUND_PROVIDER_NOT_CONFIGURED',
        details: { provider: providerName },
        message: 'The sandbox payment provider is not configured for refunds.',
      });
    }

    const reservation = await this.refundsRepository.reserve(
      paymentId,
      actorId,
      request,
      providerName,
    );

    if (reservation.kind === 'NOT_FOUND') {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found.',
      });
    }

    if (reservation.kind === 'NOT_REFUNDABLE') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_REFUNDABLE',
        details: { status: reservation.status },
        message: `Payment in ${reservation.status} cannot be refunded.`,
      });
    }

    if (reservation.kind === 'PROVIDER_REFERENCE_MISSING') {
      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_REFERENCE_MISSING',
        message: 'The successful payment has no provider payment reference.',
      });
    }

    if (reservation.kind === 'AMOUNT_EXCEEDED') {
      throw new ConflictException({
        code: 'REFUND_AMOUNT_EXCEEDED',
        details: { availableAmount: reservation.availableAmount },
        message: 'The requested refund exceeds the available payment amount.',
      });
    }

    if (
      !reservation.created &&
      reservation.refund.status !== RefundStatus.PENDING
    ) {
      return {
        refund: this.toResponse(reservation.refund),
        reused: true,
      };
    }

    const refund = reservation.refund;
    enrichCorrelation({
      orderId: refund.payment.orderId,
      refundId: refund.id,
    });
    setActiveSpanAttributes({
      'payflow.order.id': refund.payment.orderId,
      'payflow.refund.id': refund.id,
    });

    if (!reservation.created && paymentProvider.getRefund) {
      try {
        const query = await withSpan(
          'provider.refund.query',
          {
            attributes: {
              'payment.provider': providerName,
              'payflow.payment.id': refund.paymentId,
              'payflow.refund.id': refund.id,
            },
            kind: SpanKind.CLIENT,
          },
          () =>
            paymentProvider.getRefund!({
              amount: refund.amount,
              currency: refund.payment.currency,
              merchantReference: refund.paymentId,
              providerPaymentId: refund.payment.providerPaymentId!,
              providerRefundId: refund.providerRefundId,
              refundId: refund.id,
            }),
        );
        const mutation = await this.refundsRepository.applyProviderResult(
          refund.id,
          actorId,
          { ...query, status: this.localRefundStatus(query.status) },
        );
        return {
          refund: this.toResponse(mutation.refund),
          reused: true,
        };
      } catch (error: unknown) {
        if (!this.refundNotFound(error)) {
          const failure = this.providerFailure(error);
          throw new BadGatewayException({
            code: 'REFUND_QUERY_OUTCOME_UNKNOWN',
            details: {
              provider: paymentProvider.name,
              providerCode: failure.code,
            },
            message:
              'The pending provider refund could not be safely confirmed.',
          });
        }
      }
    }

    if (!(await this.refundsRepository.beginProviderAttempt(refund.id))) {
      return {
        refund: this.toResponse(refund),
        reused: true,
      };
    }

    try {
      const result = await withSpan(
        'provider.refund.create',
        {
          attributes: {
            'payment.provider': providerName,
            'payflow.order.id': refund.payment.orderId,
            'payflow.payment.id': refund.paymentId,
            'payflow.refund.id': refund.id,
          },
          kind: SpanKind.CLIENT,
        },
        () =>
          paymentProvider.refundPayment({
            amount: refund.amount,
            currency: refund.payment.currency,
            idempotencyKey: refund.idempotencyKey,
            orderId: refund.payment.orderId,
            paymentId: refund.paymentId,
            providerPaymentId: refund.payment.providerPaymentId!,
            refundId: refund.id,
            refundRequestId: refund.refundRequestId,
          }),
      );
      const mutation = await this.refundsRepository.applyProviderResult(
        refund.id,
        actorId,
        {
          ...result,
          status: this.localRefundStatus(result.status),
        },
      );
      if (mutation.changed && mutation.refund.status === RefundStatus.FAILED) {
        recordRefundFailure({ provider: providerName });
      }

      return {
        refund: this.toResponse(mutation.refund),
        reused: !reservation.created,
      };
    } catch (error: unknown) {
      const failure = this.providerFailure(error);

      if (!failure.outcomeUnknown) {
        const mutation = await this.refundsRepository.recordProviderFailure(
          refund.id,
          actorId,
          failure.code,
          failure.message,
          failure.requestId,
        );
        if (mutation.changed) {
          recordRefundFailure({ provider: providerName });
        }
      }

      throw new BadGatewayException({
        code: failure.outcomeUnknown
          ? 'REFUND_PROVIDER_OUTCOME_UNKNOWN'
          : 'REFUND_PROVIDER_ERROR',
        details: {
          provider: paymentProvider.name,
          providerCode: failure.code,
          retryWithSameRefundRequestId: failure.outcomeUnknown,
        },
        message: failure.outcomeUnknown
          ? 'The provider refund outcome is unknown. Retry with the same refundRequestId.'
          : 'The provider rejected the refund request.',
      });
    }
  }

  toResponse(refund: RefundWithPayment): RefundResponseDto {
    return {
      amount: refund.amount,
      createdAt: refund.createdAt.toISOString(),
      failureCode: refund.failureCode,
      failureMessage: refund.failureMessage,
      id: refund.id,
      paymentId: refund.paymentId,
      providerRefundId: refund.providerRefundId,
      reason: refund.reason,
      refundRequestId: refund.refundRequestId,
      status: refund.status,
      updatedAt: refund.updatedAt.toISOString(),
    };
  }

  private providerFailure(error: unknown): {
    code: string;
    message: string;
    outcomeUnknown: boolean;
    requestId: string | null;
  } {
    if (error instanceof PaymentProviderError) {
      return {
        code: error.code.slice(0, 100),
        message: error.message.slice(0, 500),
        outcomeUnknown: error.outcomeUnknown,
        requestId: error.requestId,
      };
    }

    return {
      code: 'REFUND_RESPONSE_PERSISTENCE_FAILED',
      message: 'The verified provider refund response could not be persisted.',
      outcomeUnknown: true,
      requestId: null,
    };
  }

  private providerFor(
    name: DatabasePaymentProvider,
  ): PaymentProvider | undefined {
    if (this.providers instanceof PaymentProviderRegistry) {
      return this.providers.get(name);
    }

    return this.providers.name === name ? this.providers : undefined;
  }

  private refundNotFound(error: unknown): boolean {
    return (
      error instanceof PaymentProviderError &&
      new Set(['ACQ.REFUND_NOT_EXIST', 'REFUND_NOT_EXIST']).has(error.code)
    );
  }

  private localRefundStatus(status: ProviderRefundStatus): RefundStatus {
    switch (status) {
      case ProviderRefundStatus.PENDING:
        return RefundStatus.PENDING;
      case ProviderRefundStatus.SUCCEEDED:
        return RefundStatus.SUCCEEDED;
      case ProviderRefundStatus.FAILED:
        return RefundStatus.FAILED;
    }
  }
}
