'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ApiError, apiRequest, type CheckoutSessionResponse } from '@/lib/api';

import { useAuth } from './auth-provider';

export function StripeCheckoutButton({ orderId }: { orderId: string }) {
  const { status, token } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') {
    return (
      <div
        className="h-12 w-full animate-pulse rounded-md bg-[#e1e5eb] sm:w-64"
        aria-label="Checking payment session"
        role="status"
      />
    );
  }

  if (status === 'unauthenticated' || !token) {
    return (
      <Link
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
        href="/login"
      >
        Sign in to pay
      </Link>
    );
  }

  async function openCheckout(): Promise<void> {
    if (submitting || !token) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const checkout = await apiRequest<CheckoutSessionResponse>(
        '/payments/checkout-session',
        {
          body: JSON.stringify({ orderId }),
          method: 'POST',
          token,
        },
      );
      const destination = new URL(checkout.checkoutUrl);

      if (
        destination.protocol !== 'https:' ||
        destination.hostname !== 'checkout.stripe.com'
      ) {
        throw new Error('Unexpected Checkout destination.');
      }

      window.location.assign(destination.href);
    } catch (requestError: unknown) {
      if (requestError instanceof ApiError) {
        setError(
          requestError.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED'
            ? 'Stripe Test mode needs a sandbox secret key before Checkout can open.'
            : requestError.message,
        );
      } else {
        setError('Checkout returned an invalid destination. Please retry.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        className="min-h-12 rounded-md bg-[#635bff] px-6 font-semibold text-white shadow-[0_4px_0_#3d35c8] hover:-translate-y-0.5 hover:bg-[#534be8] disabled:cursor-wait disabled:translate-y-0 disabled:bg-[#858b95] disabled:shadow-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
        disabled={submitting}
        onClick={() => void openCheckout()}
        type="button"
      >
        {submitting ? 'Opening Stripe Test…' : 'Pay with Stripe Test'}
      </button>
      {error ? (
        <p
          className="mt-4 max-w-xl border-l-4 border-[#b42335] bg-[#fff0f2] p-4 text-sm text-[#7e1d2c]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
