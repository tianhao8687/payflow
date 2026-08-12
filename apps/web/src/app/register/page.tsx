import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth-form';
import { AuthPageShell } from '@/components/auth-page-shell';

export const metadata: Metadata = {
  title: 'Register',
};

export default function RegisterPage() {
  return (
    <AuthPageShell mode="register">
      <AuthForm mode="register" />
    </AuthPageShell>
  );
}
