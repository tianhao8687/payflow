import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  function createContext(role?: 'USER' | 'ADMIN'): ExecutionContext {
    return {
      getClass: jest.fn(),
      getHandler: jest.fn(),
      switchToHttp: () => ({
        getRequest: () =>
          role
            ? {
                user: {
                  id: '7f74dc32-355b-4e96-b5ec-3ef0114dd001',
                  role,
                },
              }
            : {},
      }),
    } as unknown as ExecutionContext;
  }

  it('allows routes without a role requirement', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('allows ADMIN and rejects USER at the administrator boundary', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(createContext('ADMIN'))).toBe(true);
    expect(() => guard.canActivate(createContext('USER'))).toThrow(
      ForbiddenException,
    );
  });

  it('requires authentication before evaluating a role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(() => guard.canActivate(createContext())).toThrow(
      UnauthorizedException,
    );
  });
});
