import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@payflow/database';

import { RefundSummaryResponseDto } from '../../refunds/dto/refund-response.dto';

export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'PF-DESK-001' })
  skuSnapshot!: string;

  @ApiProperty({ example: 'Ledger Desk Pad' })
  nameSnapshot!: string;

  @ApiProperty({ example: 3400 })
  unitPriceAmount!: number;

  @ApiProperty({ example: 2, minimum: 1 })
  quantity!: number;

  @ApiProperty({ example: 6800 })
  lineTotalAmount!: number;
}

export class OrderPaymentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PaymentProvider })
  provider!: PaymentProvider;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty({ description: 'Integer amount in the currency minor unit.' })
  amount!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [RefundSummaryResponseDto] })
  refunds!: RefundSummaryResponseDto[];
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'PF-20260812-A1B2C3D4' })
  orderNo!: string;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PENDING_PAYMENT })
  status!: OrderStatus;

  @ApiProperty({ example: 'USD', maxLength: 3, minLength: 3 })
  currency!: string;

  @ApiProperty({ example: 6800 })
  subtotalAmount!: number;

  @ApiProperty({ example: 6800 })
  totalAmount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: [OrderPaymentSummaryResponseDto] })
  payments!: OrderPaymentSummaryResponseDto[];
}
