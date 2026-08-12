import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth-form';
import { AuthPageShell } from '@/components/auth-page-shell';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <AuthPageShell mode="login">
      <AuthForm mode="login" />
    </AuthPageShell>
  );
}
