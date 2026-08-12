import type { UserRole } from '@payflow/shared';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

export interface JwtPayload {
  role: UserRole;
  sub: string;
}
