'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from './auth-provider';
import { BrandMark } from './brand-mark';
import { useCart } from './cart-provider';

const navigation = [
  { href: '/', label: 'Catalog' },
  { href: '/system', label: 'System' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { logout, status, user } = useAuth();
  const { count } = useCart();

  return (
    <header className="border-b border-[#d7dbe2] bg-white">
      <div className="mx-auto flex min-h-[76px] max-w-[1536px] flex-wrap items-center justify-between gap-x-5 gap-y-3 px-5 py-4 sm:min-h-[86px] sm:px-8 lg:flex-nowrap lg:px-16">
        <Link
          className="inline-flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/"
          aria-label="PayFlow catalog home"
        >
          <BrandMark className="h-9 w-9 text-[#0757ff] sm:h-10 sm:w-10" />
          <span className="text-[1.55rem] font-bold tracking-[-0.055em] sm:text-[1.75rem]">
            PayFlow
          </span>
        </Link>

        <nav
          className="order-3 flex w-full items-center gap-1 overflow-x-auto lg:order-2 lg:w-auto lg:overflow-visible"
          aria-label="Primary navigation"
        >
          {navigation.map((item) => (
            <NavLink
              active={
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href)
              }
              href={item.href}
              key={item.href}
            >
              {item.label}
            </NavLink>
          ))}
          {status === 'authenticated' ? (
            <>
              <NavLink active={pathname.startsWith('/orders')} href="/orders">
                Orders
              </NavLink>
              <NavLink active={pathname.startsWith('/account')} href="/account">
                Account
              </NavLink>
            </>
          ) : null}
          {user?.role === 'ADMIN' ? (
            <NavLink active={pathname.startsWith('/admin')} href="/admin">
              Admin
            </NavLink>
          ) : null}
        </nav>

        <div className="order-2 flex shrink-0 items-center gap-2 lg:order-3">
          <Link
            aria-label={`Cart with ${count} ${count === 1 ? 'item' : 'items'}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#b8bec8] px-3.5 text-sm font-semibold hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
            href="/cart"
          >
            Cart
            <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-[#080a0f] px-1.5 font-mono text-xs text-white tabular-nums">
              {count}
            </span>
          </Link>
          {status === 'loading' ? (
            <span
              className="h-10 w-24 animate-pulse rounded-md bg-[#eef1f5]"
              aria-label="Checking session"
              role="status"
            />
          ) : status === 'authenticated' ? (
            <button
              className="min-h-10 rounded-md border border-[#b8bec8] px-3.5 text-sm font-semibold transition-colors hover:border-[#080a0f] hover:bg-[#f5f7fa] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
              onClick={logout}
              type="button"
            >
              Sign out
            </button>
          ) : (
            <Link
              className="inline-flex min-h-10 items-center rounded-md bg-[#0757ff] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
              href="/login"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-10 shrink-0 items-center rounded-md px-2.5 text-sm font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#0757ff] sm:px-3 ${
        active
          ? 'bg-[#eef3ff] text-[#0757ff]'
          : 'text-[#555b66] hover:bg-[#f5f7fa] hover:text-[#080a0f]'
      }`}
      href={href}
    >
      {children}
    </Link>
  );
}
