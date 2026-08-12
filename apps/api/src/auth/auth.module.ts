import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { ApiEnvironment } from '../config/environment';
import { UsersModule } from '../users/users.module';
import { AdminProfileController } from './admin-profile.controller';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<ApiEnvironment, true>) => ({
        secret: configService.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          audience: JWT_AUDIENCE,
          expiresIn: configService.get('JWT_EXPIRES_IN_SECONDS', {
            infer: true,
          }),
          issuer: JWT_ISSUER,
        },
      }),
    }),
  ],
  controllers: [AuthController, AdminProfileController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
