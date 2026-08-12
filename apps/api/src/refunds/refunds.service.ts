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
  PAYMENT_PROVIDER,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
  ProviderRefundStatus,
} from '@payflow/payment-core';

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
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async create(
    paymentId: string,
    actorId: string,
    request: CreateRefundRequestDto,
  ): Promise<CreateRefundResponseDto> {
    if (!this.paymentProvider.isConfigured(PaymentProviderCapability.REFUND)) {
      throw new ServiceUnavailableException({
        code: 'REFUND_PROVIDER_NOT_CONFIGURED',
        message: 'The sandbox payment provider is not configured for refunds.',
      });
    }

    const reservation = await this.refundsRepository.reserve(
      paymentId,
      actorId,
      request,
      this.databaseProvider(),
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

    try {
      const result = await this.paymentProvider.refundPayment({
        amount: refund.amount,
        idempotencyKey: refund.idempotencyKey,
        orderId: refund.payment.orderId,
        paymentId: refund.paymentId,
        providerPaymentId: refund.payment.providerPaymentId!,
        refundId: refund.id,
        refundRequestId: refund.refundRequestId,
      });
      const updated = await this.refundsRepository.applyProviderResult(
        refund.id,
        actorId,
        {
          ...result,
          status: this.localRefundStatus(result.status),
        },
      );

      return {
        refund: this.toResponse(updated),
        reused: !reservation.created,
      };
    } catch (error: unknown) {
      const failure = this.providerFailure(error);

      if (!failure.outcomeUnknown) {
        await this.refundsRepository.recordProviderFailure(
          refund.id,
          actorId,
          failure.code,
          failure.message,
          failure.requestId,
        );
      }

      throw new BadGatewayException({
        code: failure.outcomeUnknown
          ? 'REFUND_PROVIDER_OUTCOME_UNKNOWN'
          : 'REFUND_PROVIDER_ERROR',
        details: {
          provider: this.paymentProvider.name,
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

  private databaseProvider(): DatabasePaymentProvider {
    if (this.paymentProvider.name === DatabasePaymentProvider.STRIPE) {
      return DatabasePaymentProvider.STRIPE;
    }

    throw new ServiceUnavailableException({
      code: 'PAYMENT_PROVIDER_UNSUPPORTED',
      details: { provider: this.paymentProvider.name },
      message: 'The configured payment provider is not enabled locally.',
    });
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
