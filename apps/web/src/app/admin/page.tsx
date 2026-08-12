import type { Metadata } from 'next';

import { AdminBoundary } from '@/components/admin-boundary';

export const metadata: Metadata = {
  title: 'Payment operations',
};

export default function AdminPage() {
  return (
    <main id="main-content">
      <AdminBoundary />
    </main>
  );
}
