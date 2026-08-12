export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000'
).replace(/\/$/, '');

export type UserRole = 'USER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  priceAmount: number;
  currency: string;
  stock: number;
  active: boolean;
}

export interface ProductListResponse {
  count: number;
  items: Product[];
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export type PaymentProvider = 'STRIPE';
export type PaymentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface OrderPaymentSummary {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  skuSnapshot: string;
  nameSnapshot: string;
  unitPriceAmount: number;
  quantity: number;
  lineTotalAmount: number;
}

export interface Order {
  id: string;
  userId: string;
  orderNo: string;
  status: OrderStatus;
  currency: string;
  subtotalAmount: number;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
  payments: OrderPaymentSummary[];
}

export interface OrderListResponse {
  count: number;
  items: Order[];
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerCheckoutSessionId: string | null;
  attemptNo: number;
  providerCallCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
  expiresAt: string;
  payment: PaymentRecord;
  reused: boolean;
}

interface ApiErrorPayload {
  code?: string;
  details?: unknown;
  message?: string;
  requestId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly requestId?: string;
  readonly status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message ?? 'The request could not be completed.');
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code ?? `HTTP_${status}`;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }
}

interface ApiRequestOptions extends RequestInit {
  token?: string | null;
}

export async function apiRequest<T>(
  path: string,
  { token, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      isRecord(payload) ? (payload as ApiErrorPayload) : {},
    );
  }

  return payload as T;
}

export function formatMoney(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    currency,
    style: 'currency',
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  return formatter.format(amount / 10 ** fractionDigits);
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');

  if (!contentType?.includes('application/json')) {
    return undefined;
  }

  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
