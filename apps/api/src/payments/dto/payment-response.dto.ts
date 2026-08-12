import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider, PaymentStatus } from '@payflow/database';

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: PaymentProvider })
  provider!: PaymentProvider;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty({ description: 'Integer amount in the currency minor unit.' })
  amount!: number;

  @ApiProperty({ example: 'USD', maxLength: 3, minLength: 3 })
  currency!: string;

  @ApiPropertyOptional()
  providerPaymentId!: string | null;

  @ApiPropertyOptional()
  providerCheckoutSessionId!: string | null;

  @ApiProperty({ minimum: 1 })
  attemptNo!: number;

  @ApiProperty({ minimum: 0 })
  providerCallCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CheckoutSessionResponseDto {
  @ApiProperty({ description: 'Stripe-hosted test Checkout URL.' })
  checkoutUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: PaymentResponseDto })
  payment!: PaymentResponseDto;

  @ApiProperty({
    description: 'True when the local Payment already existed for this order.',
  })
  reused!: boolean;
}
