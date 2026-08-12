'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiRequest, formatMoney, type Product } from '@/lib/api';

import { AddToCartButton } from './add-to-cart-button';

type DetailState =
  | { status: 'loading' }
  | { product: Product; status: 'ready' }
  | { missing: boolean; status: 'error' };

export function ProductDetail({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    apiRequest<Product>(`/products/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((product) => setState({ product, status: 'ready' }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setState({
          missing: error instanceof ApiError && error.status === 404,
          status: 'error',
        });
      });

    return () => controller.abort();
  }, [attempt, id]);

  if (state.status === 'loading') {
    return <ProductDetailSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-20 text-center sm:px-8 sm:py-28">
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
          {state.missing ? '404 / Product' : 'API / Unavailable'}
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          {state.missing ? 'Product not found.' : 'Product could not load.'}
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          {state.missing
            ? 'This product is missing or no longer active in the public catalog.'
            : 'Check that the PayFlow API is running, then try again.'}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {!state.missing ? (
            <button
              className="min-h-11 rounded-md bg-[#080a0f] px-5 font-semibold text-white hover:bg-[#272b33] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
              type="button"
            >
              Retry
            </button>
          ) : null}
          <Link
            className="inline-flex min-h-11 items-center rounded-md border border-[#aeb4bf] px-5 font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
            href="/"
          >
            Back to catalog
          </Link>
        </div>
      </div>
    );
  }

  const { product } = state;

  return (
    <div className="mx-auto max-w-[1536px] px-5 py-10 sm:px-8 sm:py-14 lg:px-16 lg:py-20">
      <Link
        className="inline-flex min-h-11 items-center rounded-sm font-semibold text-[#555b66] hover:text-[#0757ff] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
        href="/"
      >
        <span aria-hidden="true">←</span>&nbsp; Back to catalog
      </Link>

      <div className="mt-6 grid border border-[#cdd2d9] lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="flex min-h-[360px] items-center justify-center bg-[#eaf0ff] p-10 text-[#0757ff] sm:min-h-[520px]">
          <svg
            className="h-52 w-52 sm:h-72 sm:w-72"
            fill="none"
            viewBox="0 0 96 96"
            aria-hidden="true"
          >
            <rect
              height="59"
              rx="8"
              stroke="currentColor"
              strokeWidth="2.5"
              width="59"
              x="18.5"
              y="18.5"
            />
            <path
              d="M31 36h34M31 48h34M31 60h22"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.5"
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

        <div className="flex flex-col p-6 sm:p-10 lg:p-12">
          <p className="font-mono text-xs font-bold tracking-[0.13em] text-[#0757ff] uppercase">
            {product.sku}
          </p>
          <h1 className="mt-4 text-[clamp(2.5rem,5vw,4.8rem)] leading-[0.94] font-bold tracking-[-0.065em]">
            {product.name}
          </h1>
          <p className="mt-7 text-3xl font-bold tabular-nums">
            {formatMoney(product.priceAmount, product.currency)}
          </p>

          <dl className="mt-10 divide-y divide-[#d7dbe2] border-y border-[#d7dbe2] text-sm">
            <ProductFact label="Currency" value={product.currency} />
            <ProductFact label="Sandbox stock" value={String(product.stock)} />
            <ProductFact
              label="Catalog state"
              value={product.active ? 'Active' : 'Inactive'}
            />
          </dl>

          <div className="mt-auto pt-10">
            <div className="border-l-4 border-[#08ae8c] bg-[#edf9f6] p-4">
              <p className="font-semibold">Server-authoritative checkout</p>
              <p className="mt-1 text-sm leading-6 text-[#43635c]">
                This displayed price is only a preview. Order totals are loaded
                again from PostgreSQL and calculated by the API.
              </p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <AddToCartButton
                className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-[#0757ff] px-6 font-semibold text-white shadow-[0_4px_0_#003db9] hover:-translate-y-0.5 hover:bg-[#064ce0] hover:shadow-[0_6px_0_#003db9] disabled:cursor-not-allowed disabled:bg-[#858b95] disabled:shadow-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
                product={product}
              />
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-md border border-[#aeb4bf] px-6 font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
                href="/cart"
              >
                Review cart
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-5 py-4">
      <dt className="text-[#555b66]">{label}</dt>
      <dd className="font-mono font-bold">{value}</dd>
    </div>
  );
}

function ProductDetailSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1536px] px-5 py-14 sm:px-8 lg:px-16 lg:py-20"
      aria-busy="true"
      aria-label="Loading product details"
      role="status"
    >
      <div className="h-5 w-32 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-8 grid overflow-hidden border border-[#d7dbe2] lg:grid-cols-2">
        <div className="min-h-[360px] animate-pulse bg-[#eef1f5] sm:min-h-[520px]" />
        <div className="p-8 sm:p-12">
          <div className="h-3 w-28 animate-pulse rounded bg-[#e1e5eb]" />
          <div className="mt-5 h-12 w-4/5 animate-pulse rounded bg-[#e1e5eb]" />
          <div className="mt-4 h-12 w-3/5 animate-pulse rounded bg-[#e1e5eb]" />
          <div className="mt-9 h-8 w-28 animate-pulse rounded bg-[#e1e5eb]" />
        </div>
      </div>
      <span className="sr-only">Loading product details…</span>
    </div>
  );
}
