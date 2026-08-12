import { Injectable } from '@nestjs/common';
import type { Product } from '@payflow/database';

import { DatabaseService } from '../database/database.service';

@Injectable()
export class ProductsRepository {
  constructor(private readonly database: DatabaseService) {}

  findActive(): Promise<Product[]> {
    return this.database.prisma.product.findMany({
      where: { active: true },
      orderBy: { sku: 'asc' },
    });
  }

  findActiveById(id: string): Promise<Product | null> {
    return this.database.prisma.product.findFirst({
      where: { active: true, id },
    });
  }
}
