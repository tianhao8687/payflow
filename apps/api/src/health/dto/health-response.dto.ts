import { ApiProperty } from '@nestjs/swagger';

class HealthChecksDto {
  @ApiProperty({ example: 'up' })
  database!: 'up';

  @ApiProperty({ example: 'up' })
  redis!: 'up';
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'payflow-api' })
  service!: string;

  @ApiProperty({ example: '2026-08-12T11:30:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}
