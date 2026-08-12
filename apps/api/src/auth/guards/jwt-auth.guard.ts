import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { USER_ROLES, type UserRole } from '@payflow/shared';
import type { Request } from 'express';

import { JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';
import type { AuthenticatedUser, JwtPayload } from '../auth-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw this.unauthorized();
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: ['HS256'],
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
      });

      if (typeof payload.sub !== 'string' || !this.isUserRole(payload.role)) {
        throw this.unauthorized();
      }

      request.user = { id: payload.sub, role: payload.role };
      return true;
    } catch {
      throw this.unauthorized();
    }
  }

  private extractBearerToken(request: Request): string | undefined {
    const authorization = request.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    const [scheme, token, extra] = authorization.split(' ');
    return scheme === 'Bearer' && token && !extra ? token : undefined;
  }

  private isUserRole(value: unknown): value is UserRole {
    return (
      typeof value === 'string' &&
      (USER_ROLES as readonly string[]).includes(value)
    );
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_REQUIRED',
      message: 'A valid bearer token is required.',
    });
  }
}
