'use client';

import Link from 'next/link';

import { useAuth } from './auth-provider';

export function AccountPanel() {
  const { logout, status, user } = useAuth();

  if (status === 'loading') {
    return <AccountSkeleton />;
  }

  if (status === 'unauthenticated' || !user) {
    return (
      <section className="mx-auto max-w-[760px] px-5 py-20 text-center sm:px-8 sm:py-28">
        <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
          Authentication required
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
          Your account is behind the JWT boundary.
        </h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-[#555b66]">
          Sign in to load the current user from the protected /auth/me API.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
            href="/login"
          >
            Sign in
          </Link>
          <Link
            className="inline-flex min-h-12 items-center rounded-md border border-[#aeb4bf] px-6 font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
            href="/register"
          >
            Register
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[1000px] px-5 py-14 sm:px-8 sm:py-20 lg:px-16">
      <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#08ae8c] uppercase">
        Authenticated / {user.role}
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-[-0.055em] sm:text-6xl">
        Account identity
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-[#555b66]">
        This DTO came from the protected API. Password hashes and token claims
        are intentionally absent.
      </p>

      <dl className="mt-10 divide-y divide-[#d7dbe2] border-y border-[#080a0f]">
        <AccountFact label="Email" value={user.email} />
        <AccountFact label="Role" value={user.role} />
        <AccountFact label="User ID" value={user.id} />
        <AccountFact
          label="Created"
          value={new Intl.DateTimeFormat('en-US', {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(new Date(user.createdAt))}
        />
      </dl>

      <div className="mt-8 flex flex-wrap gap-3">
        {user.role === 'ADMIN' ? (
          <Link
            className="inline-flex min-h-12 items-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
            href="/admin"
          >
            Verify admin boundary
          </Link>
        ) : null}
        <button
          className="min-h-12 rounded-md border border-[#aeb4bf] px-6 font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          onClick={logout}
          type="button"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}

function AccountFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 py-5 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-baseline">
      <dt className="text-sm font-semibold text-[#555b66]">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-sm font-bold sm:text-base">
        {value}
      </dd>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1000px] px-5 py-20 sm:px-8 lg:px-16"
      aria-busy="true"
      aria-label="Checking account session"
      role="status"
    >
      <div className="h-3 w-40 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-5 h-14 w-3/4 animate-pulse rounded bg-[#e1e5eb]" />
      <div className="mt-12 h-56 animate-pulse bg-[#eef1f5]" />
      <span className="sr-only">Checking account session…</span>
    </div>
  );
}
