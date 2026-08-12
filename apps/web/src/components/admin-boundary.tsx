'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiRequest, type User } from '@/lib/api';

import { AdminConsole } from './admin-console';
import { useAuth } from './auth-provider';

type BoundaryState =
  | { status: 'checking' }
  | { profile: User; status: 'granted' }
  | { status: 'forbidden' }
  | { status: 'error' };

export function AdminBoundary() {
  const { logout, status: authStatus, token, user } = useAuth();
  const [boundary, setBoundary] = useState<BoundaryState>({
    status: 'checking',
  });

  useEffect(() => {
    if (authStatus !== 'authenticated' || !token) {
      return;
    }

    const controller = new AbortController();

    apiRequest<User>('/admin/profile', {
      signal: controller.signal,
      token,
    })
      .then((profile) => setBoundary({ profile, status: 'granted' }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (error instanceof ApiError && error.status === 401) {
          logout();
          return;
        }

        setBoundary({
          status:
            error instanceof ApiError && error.status === 403
              ? 'forbidden'
              : 'error',
        });
      });

    return () => controller.abort();
  }, [authStatus, logout, token]);

  if (authStatus === 'loading') {
    return <AdminSkeleton label="Checking session" />;
  }

  if (authStatus === 'unauthenticated' || !user || !token) {
    return (
      <BoundaryMessage
        eyebrow="401 / Authentication required"
        heading="Sign in before testing the admin boundary."
        message="The browser has no valid bearer token to present to the protected API."
      >
        <Link
          className="inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/login"
        >
          Sign in
        </Link>
      </BoundaryMessage>
    );
  }

  if (boundary.status === 'checking') {
    return <AdminSkeleton label="Verifying administrator role" />;
  }

  if (boundary.status === 'forbidden') {
    return (
      <BoundaryMessage
        eyebrow="403 / USER role"
        heading="The API denied administrator access."
        message={`Signed in as ${user.email}. The server verified this token but rejected its USER role, which is the expected Stage 1 boundary.`}
      >
        <Link
          className="inline-flex min-h-12 items-center rounded-md border border-[#aeb4bf] px-6 font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/account"
        >
          Return to account
        </Link>
      </BoundaryMessage>
    );
  }

  if (boundary.status === 'error') {
    return (
      <BoundaryMessage
        eyebrow="Boundary unavailable"
        heading="The admin check could not complete."
        message="The session may have expired or the API may be unavailable. Sign in again and retry."
      >
        <Link
          className="inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/login"
        >
          Sign in again
        </Link>
      </BoundaryMessage>
    );
  }

  return <AdminConsole profile={boundary.profile} token={token} />;
}

function BoundaryMessage({
  children,
  eyebrow,
  heading,
  message,
}: {
  children: React.ReactNode;
  eyebrow: string;
  heading: string;
  message: string;
}) {
  return (
    <section className="mx-auto max-w-[820px] px-5 py-20 text-center sm:px-8 sm:py-28">
      <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-[-0.055em] sm:text-5xl">
        {heading}
      </h1>
      <p className="mx-auto mt-4 max-w-2xl leading-7 text-[#555b66]">
        {message}
      </p>
      <div className="mt-8 flex justify-center">{children}</div>
    </section>
  );
}

function AdminSkeleton({ label }: { label: string }) {
  return (
    <div
      className="mx-auto max-w-[1000px] px-5 py-20 sm:px-8 lg:px-16"
      aria-busy="true"
      aria-label={label}
      role="status"
    >
      <div className="h-3 w-44 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-5 h-14 w-4/5 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-12 h-48 animate-pulse bg-[#eef1f5]" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
