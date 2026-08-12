import { ApiProperty } from '@nestjs/swagger';

import { UserResponseDto } from './user-response.dto';

export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived JWT bearer token' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Token lifetime in seconds' })
  expiresIn!: number;

  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
