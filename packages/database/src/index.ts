import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from './generated/prisma/client';

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

export function isTransactionWriteConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }

  if (!(error instanceof Error) || error.name !== 'DriverAdapterError') {
    return false;
  }

  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null) {
    return false;
  }

  const details = cause as { kind?: unknown; originalCode?: unknown };
  return (
    error.message === 'TransactionWriteConflict' &&
    (details.kind === 'TransactionWriteConflict' ||
      details.originalCode === '40001')
  );
}
