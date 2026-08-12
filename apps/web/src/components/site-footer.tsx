import Link from 'next/link';

import { API_BASE_URL } from '@/lib/api';

export function SiteFooter() {
  return (
    <footer className="border-t border-[#d7dbe2] bg-[#f8f9fb]">
      <div className="mx-auto flex max-w-[1536px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-16">
        <p className="font-mono text-sm tracking-[-0.02em] text-[#555b66]">
          Sandbox only. No live funds.
        </p>
        <div className="flex items-center gap-5 text-sm font-semibold">
          <Link
            className="rounded-sm text-[#555b66] underline decoration-[#aeb4bf] underline-offset-4 hover:text-[#080a0f] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
            href="/system"
          >
            System status
          </Link>
          <a
            className="rounded-sm text-[#555b66] underline decoration-[#aeb4bf] underline-offset-4 hover:text-[#080a0f] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
            href={`${API_BASE_URL}/docs`}
          >
            API docs
          </a>
        </div>
      </div>
    </footer>
  );
}
