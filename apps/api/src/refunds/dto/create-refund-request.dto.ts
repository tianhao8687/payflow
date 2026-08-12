import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRefundRequestDto {
  @ApiPropertyOptional({
    description:
      'Integer minor-unit amount. Omit to refund all currently available amount.',
    example: 1200,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiProperty({
    description: 'Administrator-supplied audit reason.',
    example: 'Customer returned one item.',
    maxLength: 500,
    minLength: 3,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    description: 'Stable client request UUID used for end-to-end idempotency.',
    format: 'uuid',
  })
  @IsUUID('4')
  refundRequestId!: string;
}
