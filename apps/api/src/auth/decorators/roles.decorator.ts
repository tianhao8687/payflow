import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@payflow/shared';

export const ROLES_KEY = 'payflow:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
