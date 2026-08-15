import 'dotenv/config';

import { hash, truncates } from 'bcryptjs';

import { createPrismaClient, Role } from '../src';

const passwordRounds = 12;
const products = [
  {
    sku: 'PF-DESK-001',
    name: 'Ledger Desk Pad',
    priceAmount: 3400,
    currency: 'USD',
    stock: 28,
    active: true,
  },
  {
    sku: 'PF-NOTE-002',
    name: 'Webhook Field Notes',
    priceAmount: 1800,
    currency: 'USD',
    stock: 64,
    active: true,
  },
  {
    sku: 'PF-CARD-003',
    name: 'State Machine Cards',
    priceAmount: 2400,
    currency: 'USD',
    stock: 42,
    active: true,
  },
  {
    sku: 'PF-LAMP-004',
    name: 'Sandbox Signal Lamp',
    priceAmount: 8900,
    currency: 'USD',
    stock: 12,
    active: true,
  },
  {
    sku: 'PF-CNY-011',
    name: 'Alipay Sandbox Checkout Card',
    priceAmount: 8_800,
    currency: 'CNY',
    stock: 50,
    active: true,
  },
] as const;

async function seed(): Promise<void> {
  const adminEmail = readRequiredEnvironment(
    'PAYFLOW_ADMIN_EMAIL',
  ).toLowerCase();
  const adminPassword = readRequiredEnvironment('PAYFLOW_ADMIN_PASSWORD');

  if (
    adminPassword.length < 12 ||
    adminPassword.length > 72 ||
    truncates(adminPassword)
  ) {
    throw new Error(
      'PAYFLOW_ADMIN_PASSWORD must contain 12-72 characters and at most 72 UTF-8 bytes.',
    );
  }

  const prisma = createPrismaClient(readRequiredEnvironment('DATABASE_URL'));

  try {
    const passwordHash = await hash(adminPassword, passwordRounds);

    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, role: Role.ADMIN },
      create: {
        email: adminEmail,
        passwordHash,
        role: Role.ADMIN,
      },
    });

    for (const product of products) {
      await prisma.product.upsert({
        where: { sku: product.sku },
        update: product,
        create: product,
      });
    }

    console.info(
      JSON.stringify({
        event: 'database.seed.completed',
        adminEmail,
        productCount: products.length,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function readRequiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for database seeding.`);
  }

  return value;
}

void seed().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'database.seed.failed',
      message: error instanceof Error ? error.message : 'Unknown seed error',
    }),
  );
  process.exitCode = 1;
});
