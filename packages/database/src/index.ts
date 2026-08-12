import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

export {
  AuditActorType,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  PrismaClient,
  Role,
  RefundStatus,
  WebhookEventStatus,
} from './generated/prisma/client';
export type {
  AuditLog,
  Order,
  OrderItem,
  Payment,
  PaymentAttempt,
  Product,
  Refund,
  User,
  WebhookEvent,
} from './generated/prisma/client';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create the Prisma client.');
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });

  return new PrismaClient({ adapter });
}
