import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus } from '@payflow/database';

export class RefundSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Integer amount in the payment currency.' })
  amount!: number;

  @ApiProperty({ enum: RefundStatus })
  status!: RefundStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class RefundResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  refundRequestId!: string;

  @ApiPropertyOptional()
  providerRefundId!: string | null;

  @ApiProperty({ description: 'Integer amount in the payment currency.' })
  amount!: number;

  @ApiProperty({ enum: RefundStatus })
  status!: RefundStatus;

  @ApiProperty({ maxLength: 500 })
  reason!: string;

  @ApiPropertyOptional()
  failureCode!: string | null;

  @ApiPropertyOptional()
  failureMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CreateRefundResponseDto {
  @ApiProperty({ type: RefundResponseDto })
  refund!: RefundResponseDto;

  @ApiProperty({
    description: 'True when this refundRequestId already existed.',
  })
  reused!: boolean;
}
