'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiRequest, formatMoney, type Order } from '@/lib/api';

import { useAuth } from './auth-provider';
import { OrderStatusBadge } from './order-status-badge';

type DetailState =
  | { status: 'loading' }
  | { order: Order; status: 'ready' }
  | { missing: boolean; status: 'error' };

export function OrderDetail({ id }: { id: string }) {
  const { status: authStatus, token } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();

    apiRequest<Order>(`/orders/${encodeURIComponent(id)}`, {
      signal: controller.signal,
      token,
    })
      .then((order) => setState({ order, status: 'ready' }))
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
  }, [attempt, id, token]);

  if (authStatus === 'loading') {
    return <OrderDetailSkeleton />;
  }

  if (authStatus === 'unauthenticated' || !token) {
    return (
      <section className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28">
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
          Order / Protected
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          Sign in to load this order.
        </h1>
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
    return <OrderDetailSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <section
        className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28"
        role="alert"
      >
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#b42335] uppercase">
          {state.missing ? '404 / Order' : 'API / Unavailable'}
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          {state.missing ? 'Order not found.' : 'Order could not load.'}
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          {state.missing
            ? 'The order does not exist or belongs to another account.'
            : 'Check that the PayFlow API is available, then retry.'}
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
            href="/orders"
          >
            Back to orders
          </Link>
        </div>
      </section>
    );
  }

  const { order } = state;

  async function cancelOrder(): Promise<void> {
    if (!token || cancelling) {
      return;
    }

    setCancelling(true);
    setCancelError(null);

    try {
      const cancelled = await apiRequest<Order>(
        `/orders/${encodeURIComponent(order.id)}/cancel`,
        { method: 'POST', token },
      );
      setState({ order: cancelled, status: 'ready' });
    } catch (error: unknown) {
      setCancelError(
        error instanceof ApiError
          ? error.message
          : 'The order could not be cancelled.',
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16 lg:px-16 lg:py-20">
      <Link
        className="inline-flex min-h-11 items-center rounded-sm font-semibold text-[#555b66] hover:text-[#0757ff] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
        href="/orders"
      >
        <span aria-hidden="true">←</span>&nbsp; Back to orders
      </Link>

      <div className="mt-6 border border-[#cdd2d9]">
        <header className="flex flex-col gap-5 border-b border-[#cdd2d9] bg-[#f8f9fb] p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
          <div>
            <OrderStatusBadge status={order.status} />
            <h1 className="mt-4 break-words font-mono text-xl font-bold tracking-[-0.03em] sm:text-3xl">
              {order.orderNo}
            </h1>
            <p className="mt-2 text-sm text-[#555b66]">
              Created{' '}
              <time dateTime={order.createdAt}>
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                }).format(new Date(order.createdAt))}
              </time>
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-xs font-bold tracking-[0.1em] text-[#555b66] uppercase">
              Server total
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {formatMoney(order.totalAmount, order.currency)}
            </p>
          </div>
        </header>

        <div className="p-6 sm:p-8">
          <h2 className="text-2xl font-bold tracking-[-0.035em]">
            Immutable item snapshots
          </h2>
          <ul className="mt-5 divide-y divide-[#d7dbe2] border-y border-[#d7dbe2] sm:hidden">
            {order.items.map((item) => (
              <li className="py-5" key={item.id}>
                <p className="font-bold">{item.nameSnapshot}</p>
                <p className="mt-1 font-mono text-xs text-[#555b66]">
                  {item.skuSnapshot}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <MobileItemFact
                    label="Unit price"
                    value={formatMoney(item.unitPriceAmount, order.currency)}
                  />
                  <MobileItemFact
                    label="Quantity"
                    value={String(item.quantity)}
                  />
                  <MobileItemFact
                    label="Line total"
                    value={formatMoney(item.lineTotalAmount, order.currency)}
                    wide
                  />
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-baseline justify-between gap-4 sm:hidden">
            <p className="font-semibold">Subtotal</p>
            <p className="text-xl font-bold tabular-nums">
              {formatMoney(order.subtotalAmount, order.currency)}
            </p>
          </div>

          <div className="mt-5 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#080a0f] text-xs font-bold tracking-[0.08em] text-[#555b66] uppercase">
                  <th className="px-3 py-3" scope="col">
                    Item
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Unit price
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Quantity
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Line total
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr className="border-b border-[#d7dbe2]" key={item.id}>
                    <td className="px-3 py-5">
                      <p className="font-bold">{item.nameSnapshot}</p>
                      <p className="mt-1 font-mono text-xs text-[#555b66]">
                        {item.skuSnapshot}
                      </p>
                    </td>
                    <td className="px-3 py-5 text-right tabular-nums">
                      {formatMoney(item.unitPriceAmount, order.currency)}
                    </td>
                    <td className="px-3 py-5 text-right font-mono">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-5 text-right font-bold tabular-nums">
                      {formatMoney(item.lineTotalAmount, order.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="px-3 pt-5 text-right" colSpan={3} scope="row">
                    Subtotal
                  </th>
                  <td className="px-3 pt-5 text-right text-xl font-bold tabular-nums">
                    {formatMoney(order.subtotalAmount, order.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {cancelError ? (
            <p
              className="mt-6 border-l-4 border-[#b42335] bg-[#fff0f2] p-4 text-sm text-[#7e1d2c]"
              role="alert"
            >
              {cancelError}
            </p>
          ) : null}

          {order.status === 'PENDING_PAYMENT' ? (
            <div className="mt-8 border-t border-[#d7dbe2] pt-6">
              <button
                className="min-h-11 rounded-md border border-[#b42335] px-5 font-semibold text-[#8b2635] hover:bg-[#fff0f2] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
                disabled={cancelling}
                onClick={() => void cancelOrder()}
                type="button"
              >
                {cancelling ? 'Cancelling…' : 'Cancel unpaid order'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function OrderDetailSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:px-16"
      aria-busy="true"
      aria-label="Loading order"
      role="status"
    >
      <div className="h-5 w-32 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-8 h-52 animate-pulse bg-[#eef1f5]" />
      <div className="mt-4 h-72 animate-pulse bg-[#eef1f5]" />
      <span className="sr-only">Loading order…</span>
    </div>
  );
}

function MobileItemFact({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs font-semibold text-[#555b66]">{label}</dt>
      <dd className="mt-1 font-mono font-bold tabular-nums">{value}</dd>
    </div>
  );
}
