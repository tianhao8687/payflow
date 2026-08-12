'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError } from '@/lib/api';

import { useAuth } from './auth-provider';

type AuthMode = 'login' | 'register';

const content = {
  login: {
    eyebrow: 'Welcome back',
    heading: 'Sign in to your sandbox.',
    submit: 'Sign in',
  },
  register: {
    eyebrow: 'New account',
    heading: 'Create a sandbox identity.',
    submit: 'Create account',
  },
} as const;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { login, register, status, user } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copy = content[mode];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const credentials = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };

    try {
      if (mode === 'login') {
        await login(credentials);
      } else {
        await register(credentials);
      }

      router.replace('/account');
    } catch (error: unknown) {
      setErrorMessage(toFriendlyMessage(error, mode));
      setSubmitting(false);
    }
  }

  if (status === 'authenticated' && user) {
    return (
      <div className="border border-[#cdd2d9] bg-white p-6 sm:p-9">
        <p className="font-mono text-xs font-bold tracking-[0.13em] text-[#08ae8c] uppercase">
          Session active
        </p>
        <h1 className="mt-4 break-words text-3xl font-bold tracking-[-0.045em]">
          You&apos;re signed in as {user.email}.
        </h1>
        <Link
          className="mt-7 inline-flex min-h-12 items-center justify-center rounded-md bg-[#0757ff] px-6 font-semibold text-white hover:bg-[#0648d6] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff]"
          href="/account"
        >
          Open account
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-[#cdd2d9] bg-white p-6 shadow-[8px_8px_0_#e1e5eb] sm:p-9">
      <p className="font-mono text-xs font-bold tracking-[0.13em] text-[#0757ff] uppercase">
        {copy.eyebrow}
      </p>
      <h1 className="mt-4 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
        {copy.heading}
      </h1>
      <p className="mt-3 leading-6 text-[#555b66]">
        JWT sessions last 15 minutes and are kept only for this browser tab.
      </p>

      <form className="mt-8" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-bold" htmlFor={`${mode}-email`}>
            Email address
          </label>
          <input
            autoComplete="email"
            className="mt-2 min-h-12 w-full rounded-md border border-[#aeb4bf] bg-white px-3.5 text-base outline-none transition-[border-color,box-shadow] placeholder:text-[#858b95] focus:border-[#0757ff] focus:ring-3 focus:ring-[#dbe6ff]"
            disabled={submitting || status === 'loading'}
            id={`${mode}-email`}
            maxLength={320}
            name="email"
            placeholder="buyer@example.com"
            required
            type="email"
          />
        </div>

        <div className="mt-5">
          <label
            className="block text-sm font-bold"
            htmlFor={`${mode}-password`}
          >
            Password
          </label>
          <input
            aria-describedby={
              mode === 'register' ? 'password-requirements' : undefined
            }
            autoComplete={
              mode === 'register' ? 'new-password' : 'current-password'
            }
            className="mt-2 min-h-12 w-full rounded-md border border-[#aeb4bf] bg-white px-3.5 text-base outline-none transition-[border-color,box-shadow] focus:border-[#0757ff] focus:ring-3 focus:ring-[#dbe6ff]"
            disabled={submitting || status === 'loading'}
            id={`${mode}-password`}
            maxLength={72}
            minLength={mode === 'register' ? 12 : 1}
            name="password"
            required
            type="password"
          />
          {mode === 'register' ? (
            <p
              className="mt-2 text-xs leading-5 text-[#555b66]"
              id="password-requirements"
            >
              Use 12–72 characters with uppercase, lowercase, number and symbol;
              maximum 72 UTF-8 bytes.
            </p>
          ) : null}
        </div>

        <div className="mt-5 min-h-7" aria-live="polite">
          {errorMessage ? (
            <p
              className="border-l-4 border-[#c63d3d] bg-[#fff2f2] px-3 py-2 text-sm text-[#7a2828]"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>

        <button
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-[#0757ff] px-6 font-semibold text-white shadow-[0_4px_0_#003db9] transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-[#064ce0] hover:shadow-[0_6px_0_#003db9] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#0757ff] disabled:cursor-wait disabled:opacity-65 disabled:hover:translate-y-0 disabled:hover:shadow-[0_4px_0_#003db9]"
          disabled={submitting || status === 'loading'}
          type="submit"
        >
          {submitting ? 'Working…' : copy.submit}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-[#555b66]">
        {mode === 'login' ? 'Need an account?' : 'Already registered?'}{' '}
        <Link
          className="rounded-sm font-bold text-[#0757ff] underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
          href={mode === 'login' ? '/register' : '/login'}
        >
          {mode === 'login' ? 'Register' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}

function toFriendlyMessage(error: unknown, mode: AuthMode): string {
  if (error instanceof ApiError) {
    if (error.code === 'AUTH_EMAIL_EXISTS') {
      return 'That email is already registered. Try signing in.';
    }

    if (error.code === 'AUTH_INVALID_CREDENTIALS') {
      return 'Email or password is incorrect.';
    }

    if (error.status === 429) {
      return 'Too many attempts. Wait a minute before trying again.';
    }

    if (error.status === 400) {
      return mode === 'register'
        ? 'Check the email and password requirements, then try again.'
        : 'Enter a valid email and password.';
    }
  }

  return 'The API could not complete this request. Please try again.';
}
