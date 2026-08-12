import type { Metadata } from 'next';

import { ReadinessRail } from '@/components/readiness-rail';
import { SystemFlow } from '@/components/system-flow';

export const metadata: Metadata = {
  title: 'System readiness',
};

export default function SystemPage() {
  return (
    <main id="main-content">
      <section className="mx-auto grid max-w-[1536px] gap-14 px-5 py-14 sm:px-8 sm:py-20 lg:items-center lg:px-16 lg:py-24 xl:grid-cols-[0.9fr_1.1fr] xl:gap-12">
        <div className="max-w-[680px]">
          <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
            Stage 10 / Runtime + telemetry
          </p>
          <h1 className="mt-5 text-[clamp(3rem,6vw,5.5rem)] leading-[0.91] font-bold tracking-[-0.07em]">
            Explicit state, visible boundaries.
          </h1>
          <p className="mt-7 max-w-[590px] text-lg leading-8 text-[#555b66]">
            Web, API, PostgreSQL, Redis, BullMQ Worker, Stripe, and PayPal cross
            explicit provider and queue boundaries. JSON logs, Prometheus
            metrics, and correlated traces make each durable transition visible.
          </p>
        </div>
        <SystemFlow />
      </section>

      <section
        className="mx-auto max-w-[1536px] px-5 pb-16 sm:px-8 sm:pb-20 lg:px-16"
        aria-labelledby="readiness-heading"
      >
        <div className="border-y border-[#cdd2d9] py-9 sm:py-10">
          <h2
            className="text-[1.75rem] font-bold tracking-[-0.04em]"
            id="readiness-heading"
          >
            System readiness
          </h2>
          <ReadinessRail />
        </div>
      </section>
    </main>
  );
}
