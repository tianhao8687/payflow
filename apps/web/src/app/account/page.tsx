import type { Metadata } from 'next';

import { AccountPanel } from '@/components/account-panel';

export const metadata: Metadata = {
  title: 'Account',
};

export default function AccountPage() {
  return (
    <main id="main-content">
      <AccountPanel />
    </main>
  );
}
