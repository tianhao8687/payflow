import { ApiProperty } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PF-DESK-001' })
  sku!: string;

  @ApiProperty({ example: 'Ledger Desk Pad' })
  name!: string;

  @ApiProperty({
    example: 3400,
    description:
      'Price in the currency minor unit; never a floating-point value.',
  })
  priceAmount!: number;

  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  currency!: string;

  @ApiProperty({ example: 28, minimum: 0 })
  stock!: number;

  @ApiProperty({ example: true })
  active!: boolean;
}
