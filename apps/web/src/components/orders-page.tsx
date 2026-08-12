'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiRequest, formatMoney, type OrderListResponse } from '@/lib/api';

import { useAuth } from './auth-provider';
import { OrderStatusBadge } from './order-status-badge';

type OrdersState =
  | { status: 'loading' }
  | { data: OrderListResponse; status: 'ready' }
  | { status: 'error' };

export function OrdersPage() {
  const { status: authStatus, token } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OrdersState>({ status: 'loading' });

  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();

    apiRequest<OrderListResponse>('/orders', {
      signal: controller.signal,
      token,
    })
      .then((data) => setState({ data, status: 'ready' }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState({ status: 'error' });
      });

    return () => controller.abort();
  }, [attempt, token]);

  if (authStatus === 'loading') {
    return <OrdersSkeleton />;
  }

  if (authStatus === 'unauthenticated' || !token) {
    return (
      <section className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28">
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
          Orders / Protected
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          Sign in to see your orders.
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          The API scopes every list and detail query to the authenticated user.
        </p>
        <Link
          className="mt-8 inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/login"
        >
          Sign in
        </Link>
      </section>
    );
  }

  if (state.status === 'loading') {
    return <OrdersSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <section
        className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28"
        role="alert"
      >
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#b42335] uppercase">
          API / Unavailable
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          Orders could not load.
        </h1>
        <button
          className="mt-8 min-h-12 rounded-md bg-[#080a0f] px-6 font-semibold text-white hover:bg-[#272b33] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16 lg:px-16 lg:py-20">
      <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
        Customer / Orders
      </p>
      <div className="mt-4 flex flex-col gap-5 border-b border-[#080a0f] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-[-0.055em] sm:text-6xl">
            Your order history
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#555b66]">
            Snapshot names and prices stay unchanged even if the catalog is
            edited later.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 self-start items-center rounded-md bg-[#0757ff] px-5 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff] sm:self-auto"
          href="/"
        >
          Add products
        </Link>
      </div>

      {state.data.items.length === 0 ? (
        <div className="mt-8 border border-dashed border-[#aeb4bf] p-10 text-center">
          <p className="text-xl font-bold">No orders yet</p>
          <p className="mt-2 text-[#555b66]">
            Create one from the cart to exercise server-authoritative pricing.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4">
          {state.data.items.map((order) => (
            <li
              className="border border-[#cdd2d9] bg-white p-5 sm:p-6"
              key={order.id}
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <OrderStatusBadge status={order.status} />
                  <h2 className="mt-3 break-all font-mono text-lg font-bold">
                    {order.orderNo}
                  </h2>
                  <p className="mt-2 text-sm text-[#555b66]">
                    <time dateTime={order.createdAt}>
                      {formatDate(order.createdAt)}
                    </time>
                    {' · '}
                    {order.items.length} line
                    {order.items.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-2xl font-bold tabular-nums">
                    {formatMoney(order.totalAmount, order.currency)}
                  </p>
                  <Link
                    className="mt-3 inline-flex min-h-10 items-center font-semibold text-[#0757ff] underline decoration-2 underline-offset-4 hover:text-[#003fc7] focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
                    href={`/orders/${order.id}`}
                  >
                    View order <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function OrdersSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:px-16"
      aria-busy="true"
      aria-label="Loading orders"
      role="status"
    >
      <div className="h-3 w-36 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-5 h-14 w-3/4 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-12 grid gap-4">
        <div className="h-36 animate-pulse bg-[#eef1f5]" />
        <div className="h-36 animate-pulse bg-[#eef1f5]" />
      </div>
      <span className="sr-only">Loading orders…</span>
    </div>
  );
}
