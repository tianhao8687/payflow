import { Injectable, NotFoundException } from '@nestjs/common';
import type { Product } from '@payflow/database';

import { ProductListResponseDto } from './dto/product-list-response.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async list(): Promise<ProductListResponseDto> {
    const products = await this.productsRepository.findActive();

    return {
      count: products.length,
      items: products.map((product) => this.toResponse(product)),
    };
  }

  async findById(id: string): Promise<ProductResponseDto> {
    const product = await this.productsRepository.findActiveById(id);

    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found.',
      });
    }

    return this.toResponse(product);
  }

  private toResponse(product: Product): ProductResponseDto {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      priceAmount: product.priceAmount,
      currency: product.currency,
      stock: product.stock,
      active: product.active,
    };
  }
}
