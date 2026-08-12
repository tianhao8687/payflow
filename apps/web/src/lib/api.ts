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
export type RefundStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface RefundSummary {
  id: string;
  amount: number;
  status: RefundStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrderPaymentSummary {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amount: number;
  currency: string;
  createdAt: string;
  refunds: RefundSummary[];
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
  refunds: RefundSummary[];
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
  expiresAt: string;
  payment: PaymentRecord;
  reused: boolean;
}

export interface AdminCurrencyAmount {
  amount: number;
  currency: string;
}

export interface AdminDashboard {
  orderCount: number;
  successfulPaymentCount: number;
  failedPaymentCount: number;
  refundTotals: AdminCurrencyAmount[];
  failedWebhookCount: number;
}

export interface AdminPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminOrderListItem {
  id: string;
  orderNo: string;
  status: OrderStatus;
  currency: string;
  totalAmount: number;
  customerEmail: string;
  itemCount: number;
  paymentCount: number;
  createdAt: string;
}

export interface AdminOrderItem {
  id: string;
  sku: string;
  name: string;
  unitPriceAmount: number;
  quantity: number;
  lineTotalAmount: number;
}

export interface AdminRefund {
  id: string;
  paymentId: string;
  providerRefundId: string | null;
  amount: number;
  status: RefundStatus;
  reason: string;
  failureCode: string | null;
  failureMessage: string | null;
  currency: string;
  orderNo: string;
  customerEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPayment {
  id: string;
  orderId: string;
  orderNo: string;
  customerEmail: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerAttemptCount: number;
  refundedAmount: number;
  reservedRefundAmount: number;
  refunds: AdminRefund[];
  createdAt: string;
}

export interface AdminPaymentAttempt {
  id: string;
  status: string;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminPaymentDetail extends AdminPayment {
  providerCheckoutSessionId: string | null;
  attempts: AdminPaymentAttempt[];
}

export interface AdminOrderDetail extends AdminOrderListItem {
  userId: string;
  subtotalAmount: number;
  items: AdminOrderItem[];
  payments: AdminPaymentDetail[];
}

export interface AdminWebhook {
  id: string;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  status: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';
  deliveryCount: number;
  processingError: string | null;
  receivedAt: string;
  lastReceivedAt: string;
  processedAt: string | null;
}

export interface AdminAuditLog {
  id: string;
  actorType: 'ADMIN' | 'SYSTEM';
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateRefundResponse {
  refund: {
    id: string;
    paymentId: string;
    refundRequestId: string;
    providerRefundId: string | null;
    amount: number;
    status: RefundStatus;
    reason: string;
    failureCode: string | null;
    failureMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
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
