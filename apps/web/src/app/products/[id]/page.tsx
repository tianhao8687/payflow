import type { Metadata } from 'next';

import { ProductDetail } from '@/components/product-detail';

export const metadata: Metadata = {
  title: 'Product detail',
};

export default async function ProductPage({
  params,
}: PageProps<'/products/[id]'>) {
  const { id } = await params;

  return (
    <main id="main-content">
      <ProductDetail id={id} />
    </main>
  );
}
