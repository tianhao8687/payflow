import { Prisma } from '@payflow/database';

import type { DatabaseService } from '../database/database.service';
import { OrdersRepository, type OrderWithItems } from './orders.repository';

describe('OrdersRepository', () => {
  const order = {
    id: '8d6b64d2-1211-4fd8-a8eb-86dce6d646cb',
  } as OrderWithItems;

  it('retries a serializable order transaction after P2034', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce(order);
    const repository = new OrdersRepository({
      prisma: { $transaction: transaction },
    } as unknown as DatabaseService);

    await expect(
      repository.createFromCart(
        '2ea23389-e427-41ac-b1c4-9887c3310c99',
        'PF-20260813-RETRY001',
        [{ productId: '69990fe8-bd45-4889-b752-af0bd8606a31', quantity: 1 }],
        jest.fn(),
      ),
    ).resolves.toBe(order);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries the transaction conflict emitted by Prisma adapter-pg', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(adapterSerializationFailure())
      .mockResolvedValueOnce(order);
    const repository = new OrdersRepository({
      prisma: { $transaction: transaction },
    } as unknown as DatabaseService);

    await expect(
      repository.createFromCart(
        '2ea23389-e427-41ac-b1c4-9887c3310c99',
        'PF-20260813-RETRY004',
        [
          {
            productId: '69990fe8-bd45-4889-b752-af0bd8606a31',
            quantity: 1,
          },
        ],
        jest.fn(),
      ),
    ).resolves.toBe(order);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('stops after five serializable transaction conflicts', async () => {
    const error = adapterSerializationFailure();
    const transaction = jest.fn().mockRejectedValue(error);
    const repository = new OrdersRepository({
      prisma: { $transaction: transaction },
    } as unknown as DatabaseService);

    await expect(
      repository.createFromCart(
        '2ea23389-e427-41ac-b1c4-9887c3310c99',
        'PF-20260813-RETRY002',
        [{ productId: '69990fe8-bd45-4889-b752-af0bd8606a31', quantity: 1 }],
        jest.fn(),
      ),
    ).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('does not retry a non-serialization error', async () => {
    const error = new Error('database unavailable');
    const transaction = jest.fn().mockRejectedValue(error);
    const repository = new OrdersRepository({
      prisma: { $transaction: transaction },
    } as unknown as DatabaseService);

    await expect(
      repository.createFromCart(
        '2ea23389-e427-41ac-b1c4-9887c3310c99',
        'PF-20260813-RETRY003',
        [{ productId: '69990fe8-bd45-4889-b752-af0bd8606a31', quantity: 1 }],
        jest.fn(),
      ),
    ).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

function serializationFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('serialization failure', {
    clientVersion: '7.9.1',
    code: 'P2034',
  });
}

function adapterSerializationFailure(): Error {
  return Object.assign(new Error('TransactionWriteConflict'), {
    cause: {
      kind: 'TransactionWriteConflict',
      originalCode: '40001',
    },
    name: 'DriverAdapterError',
  });
}
