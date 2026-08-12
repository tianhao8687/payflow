import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateCheckoutSessionRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  orderId!: string;
}
