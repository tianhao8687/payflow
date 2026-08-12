import { ApiProperty } from '@nestjs/swagger';

import { OrderResponseDto } from './order-response.dto';

export class OrderListResponseDto {
  @ApiProperty({ minimum: 0 })
  count!: number;

  @ApiProperty({ type: [OrderResponseDto] })
  items!: OrderResponseDto[];
}
