import { ApiProperty } from '@nestjs/swagger';

export class AppInfoResponseDto {
  @ApiProperty({ example: 'PayFlow API' })
  service!: string;

  @ApiProperty({ example: 4 })
  stage!: number;

  @ApiProperty({ example: '/health' })
  health!: string;

  @ApiProperty({ example: '/docs' })
  docs!: string;
}
