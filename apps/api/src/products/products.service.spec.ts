import type { Product } from '@payflow/database';

import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  const product: Product = {
    id: 'f02f7cc0-7870-4ee4-9e7b-328f35456b64',
    sku: 'PF-DESK-001',
    name: 'Ledger Desk Pad',
    priceAmount: 3400,
    currency: 'USD',
    stock: 28,
    active: true,
  };
  let repository: {
    findActive: jest.Mock;
    findActiveById: jest.Mock;
  };
  let service: ProductsService;

  beforeEach(() => {
    repository = {
      findActive: jest.fn(),
      findActiveById: jest.fn(),
    };
    service = new ProductsService(repository as unknown as ProductsRepository);
  });

  it('returns only repository-provided active products with integer prices', async () => {
    repository.findActive.mockResolvedValue([product]);

    await expect(service.list()).resolves.toEqual({
      count: 1,
      items: [product],
    });
  });

  it('returns a product detail and reports a missing product', async () => {
    repository.findActiveById.mockResolvedValueOnce(product);
    await expect(service.findById(product.id)).resolves.toEqual(product);

    repository.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById(product.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
