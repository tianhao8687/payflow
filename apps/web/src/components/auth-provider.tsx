'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { apiRequest, type AuthResponse, type User } from '@/lib/api';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface Credentials {
  email: string;
  password: string;
}

interface AuthContextValue {
  login: (credentials: Credentials) => Promise<User>;
  logout: () => void;
  register: (credentials: Credentials) => Promise<User>;
  status: AuthStatus;
  token: string | null;
  user: User | null;
}

const TOKEN_KEY = 'payflow.stage1.access-token';
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const storedToken = window.sessionStorage.getItem(TOKEN_KEY);

    if (!storedToken) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setStatus('unauthenticated');
        }
      });
      return () => {
        active = false;
      };
    }

    const controller = new AbortController();

    apiRequest<User>('/auth/me', {
      signal: controller.signal,
      token: storedToken,
    })
      .then((currentUser) => {
        setToken(storedToken);
        setUser(currentUser);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        window.sessionStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setStatus('unauthenticated');
      });

    return () => controller.abort();
  }, []);

  const authenticate = useCallback(
    async (
      endpoint: '/auth/login' | '/auth/register',
      credentials: Credentials,
    ): Promise<User> => {
      const response = await apiRequest<AuthResponse>(endpoint, {
        body: JSON.stringify(credentials),
        method: 'POST',
      });

      window.sessionStorage.setItem(TOKEN_KEY, response.accessToken);
      setToken(response.accessToken);
      setUser(response.user);
      setStatus('authenticated');
      return response.user;
    },
    [],
  );

  const logout = useCallback((): void => {
    window.sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      login: (credentials) => authenticate('/auth/login', credentials),
      logout,
      register: (credentials) => authenticate('/auth/register', credentials),
      status,
      token,
      user,
    }),
    [authenticate, logout, status, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
