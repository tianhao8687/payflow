import { ApiProperty } from '@nestjs/swagger';

import { ProductResponseDto } from './product-response.dto';

export class ProductListResponseDto {
  @ApiProperty({ example: 4, minimum: 0 })
  count!: number;

  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];
}
