'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  apiRequest,
  formatMoney,
  type Product,
  type ProductListResponse,
} from '@/lib/api';

type CatalogState =
  | { status: 'loading' }
  | { data: ProductListResponse; status: 'ready' }
  | { message: string; status: 'error' };

const cardTones = [
  'bg-[#eaf0ff] text-[#0757ff]',
  'bg-[#e8f8f4] text-[#087f6a]',
  'bg-[#fff3d6] text-[#8a5a00]',
  'bg-[#f1ebff] text-[#6938c5]',
] as const;

export function ProductCatalog() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CatalogState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    apiRequest<ProductListResponse>('/products', {
      signal: controller.signal,
    })
      .then((data) => setState({ data, status: 'ready' }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setState({
          message: 'The catalog API is unavailable. Check the API and retry.',
          status: 'error',
        });
      });

    return () => controller.abort();
  }, [attempt]);

  if (state.status === 'loading') {
    return <CatalogSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <div
        className="mt-8 border border-[#e0a1a1] bg-[#fff7f7] p-6 sm:p-8"
        role="alert"
      >
        <p className="text-lg font-bold">Catalog could not load</p>
        <p className="mt-2 max-w-xl leading-6 text-[#6d4242]">
          {state.message}
        </p>
        <button
          className="mt-5 min-h-11 rounded-md bg-[#080a0f] px-5 font-semibold text-white hover:bg-[#272b33] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
          type="button"
        >
          Retry catalog
        </button>
      </div>
    );
  }

  if (state.data.items.length === 0) {
    return (
      <div className="mt-8 border border-dashed border-[#aeb4bf] p-10 text-center">
        <p className="text-xl font-bold">The shelf is empty</p>
        <p className="mt-2 text-[#555b66]">
          No active products are available right now.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-px overflow-hidden border border-[#cdd2d9] bg-[#cdd2d9] sm:grid-cols-2 xl:grid-cols-4">
      {state.data.items.map((product, index) => (
        <ProductCard index={index} key={product.id} product={product} />
      ))}
    </div>
  );
}

function ProductCard({ index, product }: { index: number; product: Product }) {
  const tone = cardTones[index % cardTones.length];

  return (
    <article className="group relative flex min-w-0 flex-col bg-white p-5 sm:p-6">
      <div
        className={`flex aspect-[4/3] items-end justify-between overflow-hidden p-5 ${tone}`}
        aria-hidden="true"
      >
        <span className="font-mono text-xs font-bold tracking-[0.14em] uppercase">
          PF / {String(index + 1).padStart(2, '0')}
        </span>
        <svg
          className="h-20 w-20 transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-2 sm:h-24 sm:w-24"
          fill="none"
          viewBox="0 0 96 96"
        >
          <rect
            height="59"
            rx="8"
            stroke="currentColor"
            strokeWidth="3"
            width="59"
            x="18.5"
            y="18.5"
          />
          <path
            d="M31 36h34M31 48h34M31 60h22"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="3"
          />
          <circle cx="68" cy="68" fill="currentColor" r="12" />
          <path
            d="m63 68 3.5 3.5L73 65"
            stroke="white"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
        </svg>
      </div>

      <div className="flex flex-1 flex-col pt-5">
        <p className="font-mono text-xs font-semibold tracking-[0.08em] text-[#6a707b] uppercase">
          {product.sku}
        </p>
        <h3 className="mt-2 text-xl font-bold tracking-[-0.035em]">
          <Link
            className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
            href={`/products/${product.id}`}
          >
            {product.name}
          </Link>
        </h3>
        <div className="relative mt-auto flex items-end justify-between gap-4 pt-8">
          <div>
            <p className="text-lg font-bold tabular-nums">
              {formatMoney(product.priceAmount, product.currency)}
            </p>
            <p className="mt-1 text-xs text-[#555b66]">
              {product.stock} in sandbox stock
            </p>
          </div>
          <span
            className="text-2xl text-[#0757ff] transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          >
            →
          </span>
        </div>
      </div>
    </article>
  );
}

function CatalogSkeleton() {
  return (
    <div
      className="mt-8 grid gap-px overflow-hidden border border-[#d7dbe2] bg-[#d7dbe2] sm:grid-cols-2 xl:grid-cols-4"
      aria-busy="true"
      aria-label="Loading product catalog"
      role="status"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div className="bg-white p-5 sm:p-6" key={index}>
          <div className="aspect-[4/3] animate-pulse bg-[#eef1f5]" />
          <div className="mt-5 h-3 w-24 animate-pulse rounded bg-[#e1e5eb]" />
          <div className="mt-3 h-6 w-3/4 animate-pulse rounded bg-[#e1e5eb]" />
          <div className="mt-10 h-5 w-20 animate-pulse rounded bg-[#e1e5eb]" />
        </div>
      ))}
      <span className="sr-only">Loading products…</span>
    </div>
  );
}
