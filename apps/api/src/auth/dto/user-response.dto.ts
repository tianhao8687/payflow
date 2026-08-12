import { ApiProperty } from '@nestjs/swagger';
import { USER_ROLES, type UserRole } from '@payflow/shared';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'buyer@example.com' })
  email!: string;

  @ApiProperty({ enum: USER_ROLES, example: 'USER' })
  role!: UserRole;

  @ApiProperty({ example: '2026-08-12T12:00:00.000Z' })
  createdAt!: string;
}
