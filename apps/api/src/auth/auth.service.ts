import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@payflow/database';
import { compare, hash, truncates } from 'bcryptjs';

import type { ApiEnvironment } from '../config/environment';
import { UsersRepository } from '../users/users.repository';
import {
  INVALID_CREDENTIAL_PASSWORD_HASH,
  PASSWORD_HASH_ROUNDS,
} from './auth.constants';
import type { AuthenticatedUser } from './auth-user';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class AuthService {
  private readonly expiresInSeconds: number;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    configService: ConfigService<ApiEnvironment, true>,
  ) {
    this.expiresInSeconds = configService.get('JWT_EXPIRES_IN_SECONDS', {
      infer: true,
    });
  }

  async register(input: RegisterRequestDto): Promise<AuthResponseDto> {
    if (truncates(input.password)) {
      throw new BadRequestException({
        code: 'AUTH_PASSWORD_TOO_LONG',
        message: 'Password must not exceed 72 UTF-8 bytes.',
      });
    }

    const existingUser = await this.usersRepository.findByEmail(input.email);

    if (existingUser) {
      throw this.emailConflict();
    }

    const passwordHash = await hash(input.password, PASSWORD_HASH_ROUNDS);

    try {
      const user = await this.usersRepository.createUser(
        input.email,
        passwordHash,
      );
      return this.createAuthResponse(user);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw this.emailConflict();
      }

      throw error;
    }
  }

  async login(input: LoginRequestDto): Promise<AuthResponseDto> {
    const user = await this.usersRepository.findByEmail(input.email);
    const passwordIsTruncated = truncates(input.password);
    const passwordMatches = await compare(
      input.password,
      user?.passwordHash ?? INVALID_CREDENTIAL_PASSWORD_HASH,
    );

    if (!user || passwordIsTruncated || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    return this.createAuthResponse(user);
  }

  async getCurrentUser(identity: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.usersRepository.findById(identity.id);

    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'The authenticated user no longer exists.',
      });
    }

    return this.toUserResponse(user);
  }

  private async createAuthResponse(user: User): Promise<AuthResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });

    return {
      accessToken,
      expiresIn: this.expiresInSeconds,
      user: this.toUserResponse(user),
    };
  }

  private toUserResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private emailConflict(): ConflictException {
    return new ConflictException({
      code: 'AUTH_EMAIL_EXISTS',
      message: 'An account with this email already exists.',
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
