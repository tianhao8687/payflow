import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RefundStatus } from '@payflow/database';

import type { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import {
  CreateRefundResponseDto,
  RefundResponseDto,
} from './dto/refund-response.dto';
import {
  RefundsRepository,
  type RefundWithPayment,
} from './refunds.repository';
import {
  StripeRefundGateway,
  StripeRefundGatewayError,
} from './stripe-refund.gateway';

@Injectable()
export class RefundsService {
  constructor(
    private readonly refundsRepository: RefundsRepository,
    private readonly stripeRefund: StripeRefundGateway,
  ) {}

  async create(
    paymentId: string,
    actorId: string,
    request: CreateRefundRequestDto,
  ): Promise<CreateRefundResponseDto> {
    if (!this.stripeRefund.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'REFUND_PROVIDER_NOT_CONFIGURED',
        message: 'Stripe test mode is not configured for refunds.',
      });
    }

    const reservation = await this.refundsRepository.reserve(
      paymentId,
      actorId,
      request,
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
        message:
          'The successful payment has no Stripe PaymentIntent reference.',
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
      const result = await this.stripeRefund.createRefund({
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
          providerRequestId: result.requestId,
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
          provider: 'STRIPE',
          providerCode: failure.code,
          retryWithSameRefundRequestId: failure.outcomeUnknown,
        },
        message: failure.outcomeUnknown
          ? 'Stripe refund outcome is unknown. Retry with the same refundRequestId.'
          : 'Stripe rejected the refund request.',
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
    if (error instanceof StripeRefundGatewayError) {
      return {
        code: error.code.slice(0, 100),
        message: error.message.slice(0, 500),
        outcomeUnknown: error.outcomeUnknown,
        requestId: error.requestId,
      };
    }

    return {
      code: 'REFUND_RESPONSE_PERSISTENCE_FAILED',
      message: 'The verified Stripe refund response could not be persisted.',
      outcomeUnknown: true,
      requestId: null,
    };
  }
}
