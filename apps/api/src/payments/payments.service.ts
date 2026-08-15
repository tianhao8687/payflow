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
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderError,
  PaymentProviderRegistry,
} from '@payflow/payment-core';
import {
  enrichCorrelation,
  setActiveSpanAttributes,
  SpanKind,
  withSpan,
} from '@payflow/observability';

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
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly providers: PaymentProviderRegistry | PaymentProvider,
  ) {
    this.appBaseUrl = config
      .get('APP_BASE_URL', { infer: true })
      .replace(/\/$/, '');
  }

  async createCheckoutSession(
    userId: string,
    request: CreateCheckoutSessionRequestDto,
  ): Promise<CheckoutSessionResponseDto> {
    const providerName = request.provider ?? DatabasePaymentProvider.STRIPE;
    const paymentProvider = this.providerFor(providerName);

    if (!paymentProvider) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_UNSUPPORTED',
        details: { provider: providerName },
        message: 'The selected payment provider is not enabled locally.',
      });
    }

    if (!paymentProvider.isConfigured(PaymentProviderCapability.PAYMENT)) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        details: { provider: providerName },
        message: 'The selected sandbox payment provider is not configured.',
      });
    }

    let reservation = await this.paymentsRepository.reservePayment(
      request.orderId,
      userId,
      providerName,
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

    enrichCorrelation({
      orderId: reservation.order.id,
      paymentId: reservation.payment.id,
      provider: providerName,
    });
    setActiveSpanAttributes({
      'payment.provider': providerName,
      'payflow.order.id': reservation.order.id,
      'payflow.payment.id': reservation.payment.id,
    });

    if (reservation.payment.provider !== providerName) {
      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_CONFLICT',
        details: { activeProvider: reservation.payment.provider },
        message:
          'This order already has an active checkout with another provider.',
      });
    }

    if (
      providerName === DatabasePaymentProvider.ALIPAY &&
      reservation.payment.currency !== 'CNY'
    ) {
      await this.paymentsRepository.markCreatedPaymentFailed(
        reservation.payment.id,
      );
      throw new UnprocessableEntityException({
        code: 'ALIPAY_CURRENCY_UNSUPPORTED',
        details: { currency: reservation.payment.currency },
        message: 'Alipay checkout currently accepts CNY orders only.',
      });
    }

    if (
      reservation.payment.checkoutExpiresAt &&
      reservation.payment.checkoutExpiresAt <= new Date() &&
      new Set<PaymentStatus>([
        PaymentStatus.PENDING,
        PaymentStatus.PROCESSING,
      ]).has(reservation.payment.status)
    ) {
      let recovery;
      try {
        recovery = await this.paymentsRepository.recoverExpiredPayment(
          reservation.payment.id,
          this.providerRegistry(),
        );
      } catch (error: unknown) {
        const failure = this.toProviderFailure(error);
        throw new BadGatewayException({
          code: 'PAYMENT_RECOVERY_OUTCOME_UNKNOWN',
          details: {
            provider: paymentProvider.name,
            providerCode: failure.code,
          },
          message:
            'The expired provider payment could not be safely queried and closed. Retry later.',
        });
      }
      if (recovery.status === PaymentStatus.SUCCEEDED) {
        throw new ConflictException({
          code: 'PAYMENT_ALREADY_SUCCEEDED',
          details: { paymentId: recovery.paymentId },
          message:
            'The provider confirms this payment succeeded; no second checkout was created.',
        });
      }
      if (recovery.status !== PaymentStatus.FAILED) {
        throw new ConflictException({
          code: 'PAYMENT_RECOVERY_PENDING',
          details: { status: recovery.status },
          message:
            'The provider payment is still pending confirmation; no second checkout was created.',
        });
      }
      const replacement = await this.paymentsRepository.reservePayment(
        request.orderId,
        userId,
        providerName,
      );
      if (!replacement?.payment) {
        throw new ConflictException({
          code: 'PAYMENT_RESERVATION_FAILED',
          message: 'A replacement payment could not be safely reserved.',
        });
      }
      reservation = replacement;
    }

    const payment = reservation.payment;
    if (!payment) {
      throw new ConflictException({
        code: 'PAYMENT_RESERVATION_FAILED',
        message: 'A payment could not be reserved for this order.',
      });
    }

    const existing = this.existingCheckoutResponse(
      payment,
      !reservation.created,
    );

    if (existing) {
      return existing;
    }

    if (payment.status !== PaymentStatus.CREATED) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_REUSABLE',
        details: { status: payment.status },
        message: 'The current payment cannot create another Checkout Session.',
      });
    }

    const providerAttempt = await this.paymentsRepository.startProviderAttempt(
      payment.id,
    );

    try {
      const result = await withSpan(
        'provider.payment.create',
        {
          attributes: {
            'payment.provider': providerName,
            'payflow.order.id': reservation.order.id,
            'payflow.payment.id': payment.id,
          },
          kind: SpanKind.CLIENT,
        },
        () =>
          paymentProvider.createPayment({
            amount: payment.amount,
            cancelUrl: `${this.appBaseUrl}/orders/${reservation.order.id}?checkout=cancelled`,
            currency: payment.currency,
            idempotencyKey: payment.idempotencyKey,
            lines: reservation.order.items.map((item) => ({
              name: item.nameSnapshot,
              quantity: item.quantity,
              sku: item.skuSnapshot,
              unitAmount: item.unitPriceAmount,
            })),
            merchantReference: payment.id,
            orderId: reservation.order.id,
            paymentId: payment.id,
            successUrl: this.successUrl(providerName, payment.id),
          }),
      );

      if (
        result.amount !== payment.amount ||
        result.currency !== payment.currency ||
        result.merchantReference !== payment.id
      ) {
        throw new PaymentProviderError(
          paymentProvider.name,
          'CREATE_PAYMENT',
          'PROVIDER_AMOUNT_MISMATCH',
          'The provider returned an amount or currency that differs from the local payment.',
          result.providerRequestId,
        );
      }

      assertPaymentTransition(payment.status, PaymentStatus.PENDING);
      const completedPayment =
        await this.paymentsRepository.completeCheckoutSession(
          payment.id,
          providerAttempt.id,
          {
            checkoutExpiresAt: result.checkoutExpiresAt,
            checkoutUrl: result.checkoutUrl,
            providerCheckoutSessionId: result.providerCheckoutSessionId,
            providerPaymentId: result.providerPaymentId,
            providerRequestId: result.providerRequestId,
          },
        );
      if (
        !completedPayment.checkoutUrl ||
        !completedPayment.checkoutExpiresAt
      ) {
        throw new Error('Completed checkout is missing its canonical URL.');
      }

      return {
        checkoutUrl: completedPayment.checkoutUrl,
        expiresAt: completedPayment.checkoutExpiresAt.toISOString(),
        payment: this.toResponse(completedPayment),
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
          provider: paymentProvider.name,
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
      !payment.checkoutExpiresAt ||
      payment.checkoutExpiresAt <= new Date()
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

  private providerFor(
    name: DatabasePaymentProvider,
  ): PaymentProvider | undefined {
    if (this.providers instanceof PaymentProviderRegistry) {
      return this.providers.get(name);
    }

    return this.providers.name === name ? this.providers : undefined;
  }

  private providerRegistry(): PaymentProviderRegistry {
    return this.providers instanceof PaymentProviderRegistry
      ? this.providers
      : new PaymentProviderRegistry([this.providers]);
  }

  private successUrl(
    provider: DatabasePaymentProvider,
    paymentId: string,
  ): string {
    if (provider === DatabasePaymentProvider.STRIPE) {
      return `${this.appBaseUrl}/payments/${paymentId}/result?session_id={CHECKOUT_SESSION_ID}`;
    }
    return `${this.appBaseUrl}/payments/${paymentId}/result?provider=${provider.toLowerCase()}`;
  }

  private toResponse(payment: PaymentWithCount): PaymentResponseDto {
    return {
      amount: payment.amount,
      attemptNo: payment.attemptNo,
      createdAt: payment.createdAt.toISOString(),
      currency: payment.currency,
      id: payment.id,
      merchantReference: payment.id,
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
