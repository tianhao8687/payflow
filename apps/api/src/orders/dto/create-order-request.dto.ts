import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderItemRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ example: 2, maximum: 99, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}

export class CreateOrderRequestDto {
  @ApiProperty({
    maxItems: 50,
    minItems: 1,
    type: [CreateOrderItemRequestDto],
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemRequestDto)
  items!: CreateOrderItemRequestDto[];
}
