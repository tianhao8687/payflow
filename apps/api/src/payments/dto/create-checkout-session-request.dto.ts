import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@payflow/database';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class CreateCheckoutSessionRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  orderId!: string;

  @ApiProperty({
    default: PaymentProvider.STRIPE,
    enum: PaymentProvider,
    required: false,
  })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider = PaymentProvider.STRIPE;
}
