import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PaymentProvider as DatabasePaymentProvider,
  PaymentStatus,
} from '@payflow/database';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
} from '@payflow/payment-core';

import type { ApiEnvironment } from '../config/environment';
import { CreateCheckoutSessionRequestDto } from './dto/create-checkout-session-request.dto';
import {
  CheckoutSessionResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';
import { assertPaymentTransition } from './payment-state-machine';
import {
  type PaymentWithCount,
  PaymentsRepository,
} from './payments.repository';

@Injectable()
export class PaymentsService {
  private readonly appBaseUrl: string;

  constructor(
    config: ConfigService<ApiEnvironment, true>,
    private readonly paymentsRepository: PaymentsRepository,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {
    this.appBaseUrl = config
      .get('APP_BASE_URL', { infer: true })
      .replace(/\/$/, '');
  }

  async createCheckoutSession(
    userId: string,
    request: CreateCheckoutSessionRequestDto,
  ): Promise<CheckoutSessionResponseDto> {
    if (!this.paymentProvider.isConfigured(PaymentProviderCapability.PAYMENT)) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'The sandbox payment provider is not configured.',
      });
    }

    const reservation = await this.paymentsRepository.reservePayment(
      request.orderId,
      userId,
      this.databaseProvider(),
    );

    if (!reservation) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found.',
      });
    }

    if (reservation.order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        code: 'ORDER_NOT_PAYABLE',
        details: { status: reservation.order.status },
        message: `Order in ${reservation.order.status} cannot start payment.`,
      });
    }

    if (reservation.order.totalAmount <= 0) {
      throw new UnprocessableEntityException({
        code: 'PAYMENT_AMOUNT_INVALID',
        message: 'Hosted checkout requires an order total greater than zero.',
      });
    }

    if (!reservation.payment) {
      throw new ConflictException({
        code: 'PAYMENT_RESERVATION_FAILED',
        message: 'A payment could not be reserved for this order.',
      });
    }

    const existing = this.existingCheckoutResponse(
      reservation.payment,
      !reservation.created,
    );

    if (existing) {
      return existing;
    }

    if (reservation.payment.status !== PaymentStatus.CREATED) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_REUSABLE',
        details: { status: reservation.payment.status },
        message: 'The current payment cannot create another Checkout Session.',
      });
    }

    const providerAttempt = await this.paymentsRepository.startProviderAttempt(
      reservation.payment.id,
    );

    try {
      const result = await this.paymentProvider.createPayment({
        amount: reservation.payment.amount,
        cancelUrl: `${this.appBaseUrl}/orders/${reservation.order.id}?checkout=cancelled`,
        currency: reservation.payment.currency,
        idempotencyKey: reservation.payment.idempotencyKey,
        lines: reservation.order.items.map((item) => ({
          name: item.nameSnapshot,
          quantity: item.quantity,
          sku: item.skuSnapshot,
          unitAmount: item.unitPriceAmount,
        })),
        orderId: reservation.order.id,
        paymentId: reservation.payment.id,
        successUrl: `${this.appBaseUrl}/payments/${reservation.payment.id}/result?session_id={CHECKOUT_SESSION_ID}`,
      });

      if (
        result.amount !== reservation.payment.amount ||
        result.currency !== reservation.payment.currency
      ) {
        throw new PaymentProviderError(
          this.paymentProvider.name,
          'CREATE_PAYMENT',
          'PROVIDER_AMOUNT_MISMATCH',
          'The provider returned an amount or currency that differs from the local payment.',
          result.providerRequestId,
        );
      }

      assertPaymentTransition(
        reservation.payment.status,
        PaymentStatus.PENDING,
      );
      const payment = await this.paymentsRepository.completeCheckoutSession(
        reservation.payment.id,
        providerAttempt.id,
        {
          checkoutExpiresAt: result.expiresAt,
          checkoutUrl: result.redirectUrl,
          providerCheckoutSessionId: result.providerCheckoutSessionId,
          providerPaymentId: result.providerPaymentId,
          providerRequestId: result.providerRequestId,
        },
      );

      return {
        checkoutUrl: result.redirectUrl,
        expiresAt: result.expiresAt.toISOString(),
        payment: this.toResponse(payment),
        reused: !reservation.created,
      };
    } catch (error: unknown) {
      const failure = this.toProviderFailure(error);
      await this.paymentsRepository.failProviderAttempt(
        providerAttempt.id,
        failure.code,
        failure.message,
        failure.requestId,
      );

      throw new BadGatewayException({
        code: 'PAYMENT_PROVIDER_ERROR',
        details: {
          provider: this.paymentProvider.name,
          providerCode: failure.code,
        },
        message:
          'The hosted payment could not be created. Retrying is safe and reuses the same idempotency key.',
      });
    }
  }

  async findById(
    paymentId: string,
    userId: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentsRepository.findOwnedById(
      paymentId,
      userId,
    );

    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found.',
      });
    }

    return this.toResponse(payment);
  }

  private existingCheckoutResponse(
    payment: PaymentWithCount,
    reused: boolean,
  ): CheckoutSessionResponseDto | null {
    if (
      payment.status !== PaymentStatus.PENDING ||
      !payment.checkoutUrl ||
      !payment.checkoutExpiresAt
    ) {
      return null;
    }

    return {
      checkoutUrl: payment.checkoutUrl,
      expiresAt: payment.checkoutExpiresAt.toISOString(),
      payment: this.toResponse(payment),
      reused,
    };
  }

  private toProviderFailure(error: unknown): {
    code: string;
    message: string;
    requestId: string | null;
  } {
    if (error instanceof PaymentProviderError) {
      return {
        code: error.code.slice(0, 100),
        message: error.message.slice(0, 500),
        requestId: error.requestId,
      };
    }

    return {
      code: 'PROVIDER_RESPONSE_PERSISTENCE_FAILED',
      message: 'The verified provider response could not be persisted.',
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

  private toResponse(payment: PaymentWithCount): PaymentResponseDto {
    return {
      amount: payment.amount,
      attemptNo: payment.attemptNo,
      createdAt: payment.createdAt.toISOString(),
      currency: payment.currency,
      id: payment.id,
      orderId: payment.orderId,
      provider: payment.provider,
      providerCallCount: payment._count.attempts,
      providerCheckoutSessionId: payment.providerCheckoutSessionId,
      providerPaymentId: payment.providerPaymentId,
      refunds: payment.refunds.map((refund) => ({
        amount: refund.amount,
        createdAt: refund.createdAt.toISOString(),
        id: refund.id,
        status: refund.status,
        updatedAt: refund.updatedAt.toISOString(),
      })),
      status: payment.status,
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
