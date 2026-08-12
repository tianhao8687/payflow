import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

export {
  AuditActorType,
  LedgerDirection,
  LedgerTransactionType,
  OrderStatus,
  OutboxEventStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  PrismaClient,
  ReconciliationIssueStatus,
  ReconciliationIssueType,
  ReconciliationRunStatus,
  Role,
  RefundStatus,
  WebhookEventStatus,
} from './generated/prisma/client';
export type {
  AuditLog,
  LedgerAccount,
  LedgerEntry,
  LedgerTransaction,
  Order,
  OrderItem,
  OutboxEvent,
  Payment,
  PaymentAttempt,
  Product,
  ReconciliationCheck,
  ReconciliationIssue,
  ReconciliationRun,
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
