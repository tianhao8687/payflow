import Link from 'next/link';

import { ProductCatalog } from '@/components/product-catalog';

export default function Home() {
  return (
    <main id="main-content">
      <section className="border-b border-[#d7dbe2] bg-[#f8f9fb]">
        <div className="mx-auto grid max-w-[1536px] gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end lg:px-16 lg:py-24">
          <div className="max-w-[820px]">
            <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase sm:text-sm">
              Stage 01 / Auth + Product
            </p>
            <h1 className="mt-5 text-[clamp(2.8rem,7vw,6.6rem)] leading-[0.88] font-bold tracking-[-0.075em]">
              Tools for reliable payment work.
            </h1>
          </div>
          <div className="border-l-4 border-[#0757ff] pl-5 sm:pl-6">
            <p className="text-base leading-7 text-[#555b66] sm:text-lg">
              A read-only sandbox catalog for the people who design, test and
              operate money movement.
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center font-semibold text-[#0757ff] underline decoration-2 underline-offset-4 hover:text-[#003fc7] focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
              href="/register"
            >
              Create a Stage 1 account <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-[1536px] px-5 py-12 sm:px-8 sm:py-16 lg:px-16 lg:py-20"
        aria-labelledby="catalog-heading"
      >
        <div className="flex flex-col gap-4 border-b border-[#080a0f] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[#555b66] uppercase">
              Public inventory
            </p>
            <h2
              className="mt-2 text-3xl font-bold tracking-[-0.045em] sm:text-4xl"
              id="catalog-heading"
            >
              The operator&apos;s shelf
            </h2>
          </div>
          <p className="max-w-[420px] text-sm leading-6 text-[#555b66] sm:text-right">
            Prices come from integer minor units in PostgreSQL. Checkout is
            intentionally outside Stage 1.
          </p>
        </div>

        <ProductCatalog />
      </section>
    </main>
  );
}
