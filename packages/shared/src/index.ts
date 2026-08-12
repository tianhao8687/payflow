export const PAYFLOW_SYSTEM_NAME = 'PayFlow';
export const PAYFLOW_CURRENT_STAGE = 2 as const;

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type ServiceStatus = 'running' | 'ready' | 'next-stage';
