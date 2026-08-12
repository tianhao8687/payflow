'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError, apiRequest, formatMoney, type Order } from '@/lib/api';

import { useAuth } from './auth-provider';
import { useCart } from './cart-provider';

export function CartPage() {
  const router = useRouter();
  const { status: authStatus, token } = useAuth();
  const { clear, items, ready, removeItem, updateQuantity } = useCart();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!ready) {
    return <CartSkeleton />;
  }

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28">
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
          Cart / Empty
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          Pick a sandbox product first.
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          Your cart stays in this browser session. Only product IDs and
          quantities are sent when an order is created.
        </p>
        <Link
          className="mt-8 inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/"
        >
          Browse catalog
        </Link>
      </section>
    );
  }

  const firstCurrency = items[0]!.product.currency;
  const sameCurrency = items.every(
    (item) => item.product.currency === firstCurrency,
  );
  const estimate = items.reduce(
    (total, item) => total + item.product.priceAmount * item.quantity,
    0,
  );

  async function submitOrder(): Promise<void> {
    if (!token || submitting) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const order = await apiRequest<Order>('/orders', {
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        }),
        method: 'POST',
        token,
      });
      clear();
      router.push(`/orders/${order.id}`);
    } catch (requestError: unknown) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : 'The order could not be created. Check the API and retry.';
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16 lg:px-16 lg:py-20">
      <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
        Stage 02 / Cart submission
      </p>
      <div className="mt-4 flex flex-col gap-4 border-b border-[#080a0f] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-[-0.055em] sm:text-6xl">
            Review your cart
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#555b66]">
            Browser prices are estimates. The API reloads each product and
            creates immutable snapshots inside one database transaction.
          </p>
        </div>
        <button
          className="min-h-11 self-start rounded-md border border-[#aeb4bf] px-4 text-sm font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff] sm:self-auto"
          onClick={clear}
          type="button"
        >
          Clear cart
        </button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <ul className="divide-y divide-[#d7dbe2] border-y border-[#d7dbe2]">
          {items.map((item) => (
            <li
              className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-center"
              key={item.product.id}
            >
              <div className="min-w-0">
                <p className="font-mono text-xs font-bold tracking-[0.08em] text-[#6a707b] uppercase">
                  {item.product.sku}
                </p>
                <Link
                  className="mt-1 inline-block rounded-sm text-xl font-bold tracking-[-0.03em] hover:text-[#0757ff] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
                  href={`/products/${item.product.id}`}
                >
                  {item.product.name}
                </Link>
                <button
                  className="mt-3 block min-h-10 text-sm font-semibold text-[#8b2635] underline hover:text-[#5f1420] focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#0757ff]"
                  onClick={() => removeItem(item.product.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>
              <div>
                <label
                  className="text-xs font-semibold text-[#555b66]"
                  htmlFor={`quantity-${item.product.id}`}
                >
                  Quantity
                </label>
                <input
                  className="mt-1 min-h-11 w-full rounded-md border border-[#aeb4bf] px-3 font-mono font-bold focus:border-[#0757ff] focus:outline-3 focus:outline-offset-2 focus:outline-[#0757ff]"
                  id={`quantity-${item.product.id}`}
                  max={Math.min(item.product.stock, 99)}
                  min="1"
                  onChange={(event) =>
                    updateQuantity(
                      item.product.id,
                      Number(event.currentTarget.value),
                    )
                  }
                  type="number"
                  value={item.quantity}
                />
              </div>
              <p className="text-left font-bold tabular-nums sm:text-right">
                {formatMoney(
                  item.product.priceAmount * item.quantity,
                  item.product.currency,
                )}
              </p>
            </li>
          ))}
        </ul>

        <aside
          className="border border-[#cdd2d9] bg-[#f8f9fb] p-6"
          aria-label="Order estimate"
        >
          <p className="font-mono text-xs font-bold tracking-[0.1em] text-[#555b66] uppercase">
            Browser estimate
          </p>
          <p className="mt-3 text-3xl font-bold tabular-nums">
            {sameCurrency
              ? formatMoney(estimate, firstCurrency)
              : 'Calculated by API'}
          </p>
          <p className="mt-3 text-sm leading-6 text-[#555b66]">
            This number is never submitted. The accepted amount comes only from
            the server response.
          </p>

          {error ? (
            <p
              className="mt-5 border-l-4 border-[#b42335] bg-[#fff0f2] p-3 text-sm text-[#7e1d2c]"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {authStatus === 'loading' ? (
            <div
              className="mt-6 h-12 animate-pulse rounded-md bg-[#e1e5eb]"
              aria-label="Checking session"
              role="status"
            />
          ) : authStatus === 'unauthenticated' ? (
            <div className="mt-6">
              <p className="text-sm font-semibold">
                Sign in before creating the order.
              </p>
              <Link
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
                href="/login"
              >
                Sign in
              </Link>
            </div>
          ) : (
            <button
              className="mt-6 min-h-12 w-full rounded-md bg-[#0757ff] px-6 font-semibold text-white shadow-[0_4px_0_#003db9] hover:-translate-y-0.5 hover:bg-[#064ce0] disabled:cursor-wait disabled:translate-y-0 disabled:bg-[#858b95] disabled:shadow-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
              disabled={submitting}
              onClick={() => void submitOrder()}
              type="button"
            >
              {submitting ? 'Creating order…' : 'Create server-priced order'}
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}

function CartSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:px-16"
      aria-busy="true"
      aria-label="Loading cart"
      role="status"
    >
      <div className="h-3 w-40 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-5 h-14 w-3/4 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-12 h-72 animate-pulse bg-[#eef1f5]" />
      <span className="sr-only">Loading cart…</span>
    </div>
  );
}
