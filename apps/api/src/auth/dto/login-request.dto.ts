import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginRequestDto {
  @ApiProperty({ example: 'buyer@example.com', maxLength: 320 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    example: 'Reliable-payments-2026!',
    minLength: 1,
    maxLength: 72,
    writeOnly: true,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}
