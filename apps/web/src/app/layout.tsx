import type { Metadata } from 'next';

import { AuthProvider } from '@/components/auth-provider';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PayFlow | Sandbox catalog',
    template: '%s | PayFlow',
  },
  description:
    'Explore the PayFlow sandbox catalog and verify its Stage 1 authentication and role boundaries.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <a
            className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-[#080a0f] px-4 py-3 font-semibold text-white focus:translate-y-0"
            href="#main-content"
          >
            Skip to content
          </a>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <div className="flex-1">{children}</div>
            <SiteFooter />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
