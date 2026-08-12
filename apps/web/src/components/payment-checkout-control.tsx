'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  ApiError,
  apiRequest,
  type CheckoutSessionResponse,
  type PaymentProvider,
} from '@/lib/api';

import { useAuth } from './auth-provider';

const providers: Array<{
  description: string;
  label: string;
  value: PaymentProvider;
}> = [
  {
    description: 'Hosted card checkout',
    label: 'Stripe Test',
    value: 'STRIPE',
  },
  {
    description: 'PayPal sandbox approval',
    label: 'PayPal Sandbox',
    value: 'PAYPAL',
  },
];

export function PaymentCheckoutControl({
  activeProvider = null,
  orderId,
}: {
  activeProvider?: PaymentProvider | null;
  orderId: string;
}) {
  const { status, token } = useAuth();
  const [provider, setProvider] = useState<PaymentProvider>(
    activeProvider ?? 'STRIPE',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') {
    return (
      <div
        className="h-36 w-full max-w-xl animate-pulse rounded-md bg-[#e1e5eb]"
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
          body: JSON.stringify({ orderId, provider }),
          method: 'POST',
          token,
        },
      );
      const destination = new URL(checkout.checkoutUrl);

      if (!isAllowedCheckoutDestination(destination, provider)) {
        throw new Error('Unexpected Checkout destination.');
      }

      window.location.assign(destination.href);
    } catch (requestError: unknown) {
      if (requestError instanceof ApiError) {
        setError(
          requestError.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED'
            ? `${providerLabel(provider)} needs sandbox credentials before checkout can open.`
            : requestError.message,
        );
      } else {
        setError('Checkout returned an invalid destination. Please retry.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <fieldset>
        <legend className="text-sm font-bold text-[#3f4652]">
          Choose a sandbox provider
        </legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {providers.map((option) => {
            const locked =
              activeProvider !== null && option.value !== activeProvider;
            return (
              <label
                className={`relative flex min-h-20 cursor-pointer items-start gap-3 border p-3 transition-colors has-[:checked]:border-[#0757ff] has-[:checked]:bg-[#eef4ff] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[#0757ff] ${
                  locked
                    ? 'cursor-not-allowed border-[#d7dbe2] opacity-45'
                    : 'border-[#aeb4bf] hover:border-[#0757ff]'
                }`}
                key={option.value}
              >
                <input
                  checked={provider === option.value}
                  className="mt-1 h-4 w-4 accent-[#0757ff]"
                  disabled={submitting || locked}
                  name="payment-provider"
                  onChange={() => setProvider(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <span className="block font-bold">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#555b66]">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {activeProvider ? (
        <p className="mt-3 text-xs leading-5 text-[#654600]">
          This order already has an active {providerLabel(activeProvider)}
          checkout, so its provider is locked.
        </p>
      ) : null}

      <button
        className={`mt-4 min-h-12 rounded-md px-6 font-semibold text-white disabled:cursor-wait disabled:bg-[#858b95] disabled:shadow-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff] ${
          provider === 'PAYPAL'
            ? 'bg-[#0070ba] shadow-[0_4px_0_#004d80] hover:-translate-y-0.5 hover:bg-[#005ea6]'
            : 'bg-[#635bff] shadow-[0_4px_0_#3d35c8] hover:-translate-y-0.5 hover:bg-[#534be8]'
        }`}
        disabled={submitting}
        onClick={() => void openCheckout()}
        type="button"
      >
        {submitting
          ? `Opening ${providerLabel(provider)}…`
          : `Pay with ${providerLabel(provider)}`}
      </button>
      {error ? (
        <p
          className="mt-4 border-l-4 border-[#b42335] bg-[#fff0f2] p-4 text-sm text-[#7e1d2c]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function isAllowedCheckoutDestination(
  destination: URL,
  provider: PaymentProvider,
): boolean {
  if (destination.protocol !== 'https:') {
    return false;
  }

  return provider === 'STRIPE'
    ? destination.hostname === 'checkout.stripe.com'
    : new Set(['sandbox.paypal.com', 'www.sandbox.paypal.com']).has(
        destination.hostname,
      );
}

function providerLabel(provider: PaymentProvider): string {
  return provider === 'STRIPE' ? 'Stripe Test' : 'PayPal Sandbox';
}
