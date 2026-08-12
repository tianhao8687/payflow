'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  ApiError,
  apiRequest,
  formatMoney,
  type PaymentRecord,
} from '@/lib/api';

import { useAuth } from './auth-provider';

type ResultState =
  | { status: 'loading' }
  | { payment: PaymentRecord; status: 'ready' }
  | { missing: boolean; status: 'error' };

const confirmingStatuses = new Set(['CREATED', 'PENDING', 'PROCESSING']);

export function PaymentResult({ paymentId }: { paymentId: string }) {
  const { status: authStatus, token } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResultState>({ status: 'loading' });

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function loadPayment(): Promise<void> {
      try {
        const payment = await apiRequest<PaymentRecord>(
          `/payments/${encodeURIComponent(paymentId)}`,
          { signal: controller.signal, token },
        );

        if (!active) {
          return;
        }

        setState({ payment, status: 'ready' });

        if (confirmingStatuses.has(payment.status)) {
          timer = setTimeout(() => void loadPayment(), 2_000);
        }
      } catch (error: unknown) {
        if (
          !active ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        setState({
          missing: error instanceof ApiError && error.status === 404,
          status: 'error',
        });
      }
    }

    void loadPayment();

    return () => {
      active = false;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [attempt, paymentId, token]);

  if (authStatus === 'loading') {
    return <ResultSkeleton />;
  }

  if (authStatus === 'unauthenticated' || !token) {
    return (
      <section className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28">
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
          Payment / Protected
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          Sign in to confirm payment status.
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          PayFlow reads only its local payment record; redirect query parameters
          are never proof of success.
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
    return <ResultSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <section
        className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28"
        role="alert"
      >
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#b42335] uppercase">
          {state.missing ? '404 / Payment' : 'API / Unavailable'}
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          {state.missing ? 'Payment not found.' : 'Status could not load.'}
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          {state.missing
            ? 'The payment does not exist or belongs to another account.'
            : 'No redirect value was trusted. Retry the protected local status API.'}
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
              Retry status
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

  const { payment } = state;
  const view = getResultView(payment);

  return (
    <section className="mx-auto max-w-[860px] px-5 py-16 sm:px-8 sm:py-24">
      <div
        className={`border-t-8 ${view.border} border-x border-b border-[#cdd2d9] p-7 sm:p-10`}
      >
        <p
          className={`font-mono text-xs font-bold tracking-[0.15em] uppercase ${view.eyebrow}`}
        >
          {payment.provider} / Local status
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.055em] sm:text-6xl">
          {view.heading}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[#555b66]">
          {view.message}
        </p>

        <dl className="mt-10 divide-y divide-[#d7dbe2] border-y border-[#d7dbe2]">
          <ResultFact
            label="Status"
            value={payment.status.replaceAll('_', ' ')}
          />
          <ResultFact
            label="Amount"
            value={formatMoney(payment.amount, payment.currency)}
          />
          <ResultFact label="Payment ID" value={payment.id} />
          <ResultFact
            label="Provider calls"
            value={String(payment.providerCallCount)}
          />
        </dl>

        {confirmingStatuses.has(payment.status) ? (
          <p
            className="mt-6 flex items-center gap-3 text-sm font-semibold text-[#555b66]"
            aria-live="polite"
          >
            <span
              className="h-3 w-3 animate-pulse rounded-full bg-[#f4a000]"
              aria-hidden="true"
            />
            Refreshing the protected local status every two seconds…
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
            href={`/orders/${payment.orderId}`}
          >
            Open order
          </Link>
          <Link
            className="inline-flex min-h-12 items-center rounded-md border border-[#aeb4bf] px-6 font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
            href="/orders"
          >
            All orders
          </Link>
        </div>
      </div>
    </section>
  );
}

function getResultView(payment: PaymentRecord): {
  border: string;
  eyebrow: string;
  heading: string;
  message: string;
} {
  if (payment.status === 'FAILED') {
    return {
      border: 'border-t-[#b42335]',
      eyebrow: 'text-[#b42335]',
      heading: 'Payment failed.',
      message:
        'The trusted server-side payment state is failed. The order remains unpaid and can be retried safely.',
    };
  }

  if (
    payment.status === 'SUCCEEDED' ||
    payment.status === 'PARTIALLY_REFUNDED' ||
    payment.status === 'REFUNDED'
  ) {
    return {
      border: 'border-t-[#08ae8c]',
      eyebrow: 'text-[#087f6a]',
      heading: 'Payment confirmed.',
      message:
        'This state came from PayFlow’s protected payment record, not from the browser redirect URL.',
    };
  }

  return {
    border: 'border-t-[#f4a000]',
    eyebrow: 'text-[#785000]',
    heading: 'Confirming payment…',
    message:
      'Returning from a provider is not proof of payment. PayFlow is waiting for a trusted queued server-side result.',
  };
}

function ResultFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
      <dt className="text-sm font-semibold text-[#555b66]">{label}</dt>
      <dd className="break-all font-mono text-sm font-bold sm:text-base">
        {value}
      </dd>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div
      className="mx-auto max-w-[860px] px-5 py-20 sm:px-8"
      aria-busy="true"
      aria-label="Loading local payment status"
      role="status"
    >
      <div className="h-3 w-40 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-5 h-14 w-3/4 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-10 h-64 animate-pulse bg-[#eef1f5]" />
      <span className="sr-only">Loading local payment status…</span>
    </div>
  );
}
