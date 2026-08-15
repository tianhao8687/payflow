'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  apiRequest,
  formatMoney,
  type AdminAuditLog,
  type AdminDashboard,
  type AdminOrderDetail,
  type AdminOrderListItem,
  type AdminPage,
  type AdminPayment,
  type AdminPaymentDetail,
  type AdminRefund,
  type AdminWebhook,
  type AdminWebhookQueue,
  type CreateRefundResponse,
  type User,
} from '@/lib/api';
import { IntegrityPanel } from './integrity-panel';

type AdminTab =
  | 'dashboard'
  | 'orders'
  | 'payments'
  | 'refunds'
  | 'webhooks'
  | 'queue'
  | 'integrity'
  | 'audit';

type ResourceState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { data: T; status: 'ready' }
  | { message: string; status: 'error' };

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'orders', label: 'Orders' },
  { id: 'payments', label: 'Payments' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'queue', label: 'Queue' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'audit', label: 'Audit log' },
];

export function AdminConsole({
  profile,
  token,
}: {
  profile: User;
  token: string;
}) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');

  return (
    <section className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
      <header className="overflow-hidden border border-[#080a0f] bg-[#080a0f] text-white">
        <div className="grid gap-8 px-6 py-8 sm:px-9 sm:py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="font-mono text-xs font-bold tracking-[0.16em] text-[#71a0ff] uppercase">
              Stage 11 / Multi-provider operations
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-[-0.06em] sm:text-6xl">
              Payment control room
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#b9c0cc] sm:text-base">
              Provider state, durable event delivery, balanced money entries,
              reconciliation, and administrator decisions are visible here.
            </p>
          </div>
          <div className="border-l-2 border-[#08ae8c] pl-4 text-sm">
            <p className="font-mono text-[11px] font-bold tracking-[0.12em] text-[#83ddca] uppercase">
              ADMIN verified
            </p>
            <p className="mt-2 break-all font-semibold">{profile.email}</p>
          </div>
        </div>
        <div
          aria-label="Administrator sections"
          className="flex overflow-x-auto border-t border-[#343942]"
          role="tablist"
        >
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={`min-h-12 shrink-0 border-r border-[#343942] px-5 text-sm font-bold transition-colors focus-visible:z-10 focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[#71a0ff] ${
                activeTab === tab.id
                  ? 'bg-white text-[#080a0f]'
                  : 'text-[#cbd1dc] hover:bg-[#20242b] hover:text-white'
              }`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mt-8" role="tabpanel">
        {activeTab === 'dashboard' ? <DashboardPanel token={token} /> : null}
        {activeTab === 'orders' ? <OrdersPanel token={token} /> : null}
        {activeTab === 'payments' ? <PaymentsPanel token={token} /> : null}
        {activeTab === 'refunds' ? <RefundsPanel token={token} /> : null}
        {activeTab === 'webhooks' ? <WebhooksPanel token={token} /> : null}
        {activeTab === 'queue' ? <QueuePanel token={token} /> : null}
        {activeTab === 'integrity' ? <IntegrityPanel token={token} /> : null}
        {activeTab === 'audit' ? <AuditPanel token={token} /> : null}
      </div>
    </section>
  );
}

function DashboardPanel({ token }: { token: string }) {
  const resource = useAdminResource<AdminDashboard>('/admin/dashboard', token);

  if (resource.state.status !== 'ready') {
    return <ResourceStateView resource={resource} title="dashboard" />;
  }

  const dashboard = resource.state.data;
  const cards = [
    { label: 'Orders', value: String(dashboard.orderCount) },
    {
      label: 'Successful payments',
      value: String(dashboard.successfulPaymentCount),
    },
    { label: 'Failed payments', value: String(dashboard.failedPaymentCount) },
    { label: 'Failed webhooks', value: String(dashboard.failedWebhookCount) },
    {
      label: 'Pending outbox',
      value: String(dashboard.pendingOutboxEventCount),
    },
    {
      label: 'Open reconciliation',
      value: String(dashboard.openReconciliationIssueCount),
    },
  ];

  return (
    <div>
      <PanelHeading
        eyebrow="Live database projection"
        title="Operational snapshot"
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => (
          <article
            className={`border p-5 ${
              index === 2 || index === 3 || index === 5
                ? 'border-[#efb6be] bg-[#fff7f8]'
                : 'border-[#cdd2d9] bg-[#f8f9fb]'
            }`}
            key={card.label}
          >
            <p className="text-sm font-semibold text-[#555b66]">{card.label}</p>
            <p className="mt-5 font-mono text-4xl font-bold tracking-[-0.05em] tabular-nums">
              {card.value}
            </p>
          </article>
        ))}
      </div>

      <article className="mt-4 border border-[#80cdbd] bg-[#edf9f6] p-5 sm:p-7">
        <p className="font-mono text-xs font-bold tracking-[0.12em] text-[#087f6a] uppercase">
          Successful refunds
        </p>
        {dashboard.refundTotals.length > 0 ? (
          <ul className="mt-5 flex flex-wrap gap-3">
            {dashboard.refundTotals.map((total) => (
              <li
                className="min-w-44 border border-[#80cdbd] bg-white px-4 py-3"
                key={total.currency}
              >
                <span className="block text-xs font-semibold text-[#43635c]">
                  {total.currency}
                </span>
                <span className="mt-1 block text-2xl font-bold tabular-nums">
                  {formatMoney(total.amount, total.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[#43635c]">
            No successful refunds have been projected yet.
          </p>
        )}
      </article>
    </div>
  );
}

function OrdersPanel({ token }: { token: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const path = useMemo(
    () =>
      endpoint('/admin/orders', {
        page,
        pageSize: 10,
        query: query || undefined,
        status: status || undefined,
      }),
    [page, query, status],
  );
  const resource = useAdminResource<AdminPage<AdminOrderListItem>>(path, token);
  const detail = useAdminResource<AdminOrderDetail>(
    selectedId ? `/admin/orders/${encodeURIComponent(selectedId)}` : null,
    token,
  );

  return (
    <div>
      <PanelHeading eyebrow="Customer and state lookup" title="Orders" />
      <FilterBar
        onSubmit={() => {
          setPage(1);
          setQuery(draftQuery.trim());
        }}
      >
        <FilterText
          label="Order or email"
          onChange={setDraftQuery}
          placeholder="PF-2026… or customer@example.com"
          value={draftQuery}
        />
        <FilterSelect label="Status" onChange={setStatus} value={status}>
          <option value="">All statuses</option>
          {[
            'PENDING_PAYMENT',
            'PAID',
            'FULFILLED',
            'CANCELLED',
            'PARTIALLY_REFUNDED',
            'REFUNDED',
          ].map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <ResourceList resource={resource} title="orders">
          {(data) =>
            data.items.length > 0 ? (
              <div>
                <ul className="grid gap-3">
                  {data.items.map((order) => (
                    <li
                      className={`border p-4 sm:p-5 ${
                        selectedId === order.id
                          ? 'border-[#0757ff] bg-[#f3f6ff]'
                          : 'border-[#d7dbe2]'
                      }`}
                      key={order.id}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <StatusPill value={order.status} />
                          <p className="mt-3 break-all font-mono text-sm font-bold">
                            {order.orderNo}
                          </p>
                          <p className="mt-2 text-sm text-[#555b66]">
                            {order.customerEmail}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="text-xl font-bold tabular-nums">
                            {formatMoney(order.totalAmount, order.currency)}
                          </p>
                          <p className="mt-1 text-xs text-[#555b66]">
                            {order.itemCount} items · {order.paymentCount}{' '}
                            payments
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#d7dbe2] pt-3">
                        <time
                          className="text-xs text-[#555b66]"
                          dateTime={order.createdAt}
                        >
                          {formatDate(order.createdAt)}
                        </time>
                        <button
                          className="min-h-10 rounded-md border border-[#080a0f] px-4 text-sm font-bold hover:bg-[#080a0f] hover:text-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
                          onClick={() => setSelectedId(order.id)}
                          type="button"
                        >
                          Inspect order
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Paginator data={data} onPage={setPage} />
              </div>
            ) : (
              <EmptyState label="No orders match these filters." />
            )
          }
        </ResourceList>

        <DetailRail title="Order detail">
          {!selectedId ? (
            <EmptyState label="Select an order to inspect its immutable items and payment history." />
          ) : detail.state.status === 'ready' ? (
            <OrderDetailCard order={detail.state.data} />
          ) : (
            <ResourceStateView resource={detail} title="order detail" compact />
          )}
        </DetailRail>
      </div>
    </div>
  );
}

function PaymentsPanel({ token }: { token: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const path = useMemo(
    () =>
      endpoint('/admin/payments', {
        page,
        pageSize: 10,
        query: query || undefined,
        status: status || undefined,
      }),
    [page, query, status],
  );
  const resource = useAdminResource<AdminPage<AdminPayment>>(path, token);
  const detail = useAdminResource<AdminPaymentDetail>(
    selectedId ? `/admin/payments/${encodeURIComponent(selectedId)}` : null,
    token,
  );

  return (
    <div>
      <PanelHeading eyebrow="Provider and attempt tracing" title="Payments" />
      <FilterBar
        onSubmit={() => {
          setPage(1);
          setQuery(draftQuery.trim());
        }}
      >
        <FilterText
          label="Provider ID, order, or email"
          onChange={setDraftQuery}
          placeholder="pi_… or PF-…"
          value={draftQuery}
        />
        <FilterSelect label="Status" onChange={setStatus} value={status}>
          <option value="">All statuses</option>
          {[
            'CREATED',
            'PENDING',
            'PROCESSING',
            'SUCCEEDED',
            'FAILED',
            'PARTIALLY_REFUNDED',
            'REFUNDED',
          ].map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <ResourceList resource={resource} title="payments">
          {(data) =>
            data.items.length > 0 ? (
              <div>
                <ul className="grid gap-3">
                  {data.items.map((payment) => (
                    <li
                      className={`border p-4 sm:p-5 ${
                        selectedId === payment.id
                          ? 'border-[#0757ff] bg-[#f3f6ff]'
                          : 'border-[#d7dbe2]'
                      }`}
                      key={payment.id}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <StatusPill value={payment.status} />
                            <StatusPill value={payment.provider} />
                          </div>
                          <p className="mt-3 break-all font-mono text-xs font-bold">
                            {payment.providerPaymentId ?? 'Provider ID pending'}
                          </p>
                          <p className="mt-2 text-sm text-[#555b66]">
                            {payment.orderNo} · {payment.customerEmail}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="text-xl font-bold tabular-nums">
                            {formatMoney(payment.amount, payment.currency)}
                          </p>
                          <p className="mt-1 text-xs text-[#555b66]">
                            {payment.providerAttemptCount} provider attempts
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 border-t border-[#d7dbe2] pt-3 text-xs text-[#555b66] sm:grid-cols-2">
                        <span>
                          Refunded:{' '}
                          <strong className="text-[#080a0f]">
                            {formatMoney(
                              payment.refundedAmount,
                              payment.currency,
                            )}
                          </strong>
                        </span>
                        <button
                          className="min-h-10 justify-self-start rounded-md border border-[#080a0f] px-4 text-sm font-bold text-[#080a0f] hover:bg-[#080a0f] hover:text-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff] sm:justify-self-end"
                          onClick={() => setSelectedId(payment.id)}
                          type="button"
                        >
                          Inspect attempts
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Paginator data={data} onPage={setPage} />
              </div>
            ) : (
              <EmptyState label="No payments match these filters." />
            )
          }
        </ResourceList>

        <DetailRail title="Payment detail">
          {!selectedId ? (
            <EmptyState label="Select a payment to inspect provider attempts and refunds." />
          ) : detail.state.status === 'ready' ? (
            <PaymentDetailCard payment={detail.state.data} />
          ) : (
            <ResourceStateView
              resource={detail}
              title="payment detail"
              compact
            />
          )}
        </DetailRail>
      </div>
    </div>
  );
}

function RefundsPanel({ token }: { token: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRefundResponse | null>(null);
  const path = useMemo(
    () =>
      endpoint('/admin/refunds', {
        page,
        pageSize: 10,
        status: status || undefined,
      }),
    [page, status],
  );
  const resource = useAdminResource<AdminPage<AdminRefund>>(
    path,
    token,
    revision,
  );

  async function submitRefund(): Promise<void> {
    if (submitting) {
      return;
    }

    const stableRequestId = requestId ?? crypto.randomUUID();
    setRequestId(stableRequestId);
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);

    try {
      const parsedAmount = amount === '' ? undefined : Number(amount);
      const response = await apiRequest<CreateRefundResponse>(
        `/admin/payments/${encodeURIComponent(paymentId.trim())}/refunds`,
        {
          body: JSON.stringify({
            ...(parsedAmount === undefined ? {} : { amount: parsedAmount }),
            reason: reason.trim(),
            refundRequestId: stableRequestId,
          }),
          method: 'POST',
          token,
        },
      );
      setResult(response);
      setRequestId(null);
      setAmount('');
      setRevision((value) => value + 1);
    } catch (error: unknown) {
      const retainRequestId =
        !(error instanceof ApiError) ||
        error.code === 'REFUND_PROVIDER_OUTCOME_UNKNOWN';
      const message =
        error instanceof ApiError
          ? `${error.message} (${error.code})`
          : 'The refund request could not complete.';
      if (!retainRequestId) {
        setRequestId(null);
      }
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PanelHeading
        eyebrow="Locked balance and stable request key"
        title="Refunds"
      />
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(340px,0.75fr)_minmax(0,1.25fr)]">
        <article className="self-start border border-[#080a0f] bg-[#f8f9fb] p-5 sm:p-7 xl:sticky xl:top-6">
          <p className="font-mono text-xs font-bold tracking-[0.12em] text-[#0757ff] uppercase">
            Create refund
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em]">
            Full or partial
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#555b66]">
            Leave amount empty to reserve the full remaining balance. Amounts
            use the payment currency&apos;s minor unit.
          </p>
          <form
            className="mt-6 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRefund();
            }}
          >
            <FieldLabel label="Payment UUID">
              <input
                className={inputClass}
                onChange={(event) => {
                  setPaymentId(event.target.value);
                  setRequestId(null);
                }}
                placeholder="11111111-…"
                required
                value={paymentId}
              />
            </FieldLabel>
            <FieldLabel label="Amount (optional minor units)">
              <input
                className={inputClass}
                inputMode="numeric"
                min={1}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setRequestId(null);
                }}
                placeholder="Full remaining balance"
                step={1}
                type="number"
                value={amount}
              />
            </FieldLabel>
            <FieldLabel label="Audit reason">
              <textarea
                className={`${inputClass} min-h-28 resize-y`}
                maxLength={500}
                minLength={3}
                onChange={(event) => {
                  setReason(event.target.value);
                  setRequestId(null);
                }}
                placeholder="Why is this refund being issued?"
                required
                value={reason}
              />
            </FieldLabel>
            {requestId ? (
              <p className="border-l-4 border-[#f4a000] bg-[#fff8e5] p-3 font-mono text-xs leading-5 text-[#654600]">
                Retry key retained after an uncertain result:
                <br />
                <span className="break-all">{requestId}</span>
              </p>
            ) : null}
            {submitError ? (
              <p
                className="border-l-4 border-[#b42335] bg-[#fff0f2] p-3 text-sm text-[#7e1d2c]"
                role="alert"
              >
                {submitError}
              </p>
            ) : null}
            {result ? <RefundResult result={result} /> : null}
            <div className="flex flex-wrap gap-3">
              <button
                className="min-h-12 rounded-md bg-[#0757ff] px-5 font-bold text-white hover:bg-[#0648d6] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
                disabled={submitting}
                type="submit"
              >
                {submitting
                  ? 'Submitting…'
                  : requestId
                    ? 'Retry same request'
                    : 'Create refund'}
              </button>
              {requestId && !submitting ? (
                <button
                  className="min-h-12 rounded-md border border-[#aeb4bf] px-5 font-bold hover:border-[#080a0f] hover:bg-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
                  onClick={() => {
                    setRequestId(null);
                    setSubmitError(null);
                  }}
                  type="button"
                >
                  Start new request
                </button>
              ) : null}
            </div>
          </form>
        </article>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#080a0f] pb-4">
            <div>
              <p className="font-mono text-xs font-bold tracking-[0.1em] text-[#555b66] uppercase">
                Refund ledger
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em]">
                Provider outcomes
              </h2>
            </div>
            <FilterSelect
              label="Status"
              onChange={(value) => {
                setPage(1);
                setStatus(value);
              }}
              value={status}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="SUCCEEDED">Succeeded</option>
              <option value="FAILED">Failed</option>
            </FilterSelect>
          </div>
          <div className="mt-5">
            <ResourceList resource={resource} title="refunds">
              {(data) =>
                data.items.length > 0 ? (
                  <div>
                    <ul className="grid gap-3">
                      {data.items.map((refund) => (
                        <RefundCard key={refund.id} refund={refund} />
                      ))}
                    </ul>
                    <Paginator data={data} onPage={setPage} />
                  </div>
                ) : (
                  <EmptyState label="No refunds match this filter." />
                )
              }
            </ResourceList>
          </div>
        </div>
      </div>
    </div>
  );
}

function WebhooksPanel({ token }: { token: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const path = useMemo(
    () =>
      endpoint('/admin/webhooks', {
        eventType: eventType || undefined,
        page,
        pageSize: 10,
        status: status || undefined,
      }),
    [eventType, page, status],
  );
  const resource = useAdminResource<AdminPage<AdminWebhook>>(path, token);

  return (
    <div>
      <PanelHeading eyebrow="Signed delivery inbox" title="Webhook events" />
      <FilterBar onSubmit={() => setPage(1)}>
        <FilterText
          label="Exact event type"
          onChange={(value) => {
            setEventType(value.trim());
            setPage(1);
          }}
          placeholder="refund.updated"
          value={eventType}
        />
        <FilterSelect
          label="Status"
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="RECEIVED">Received</option>
          <option value="PROCESSED">Processed</option>
          <option value="IGNORED">Ignored</option>
          <option value="FAILED">Failed</option>
        </FilterSelect>
      </FilterBar>
      <div className="mt-6">
        <ResourceList resource={resource} title="webhooks">
          {(data) =>
            data.items.length > 0 ? (
              <div>
                <ul className="grid gap-3">
                  {data.items.map((event) => (
                    <li
                      className="border border-[#d7dbe2] p-4 sm:p-5"
                      key={event.id}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <StatusPill value={event.status} />
                            <span className="inline-flex min-h-7 items-center bg-[#eef1f5] px-2 font-mono text-[11px] font-bold">
                              {event.eventType}
                            </span>
                          </div>
                          <p className="mt-3 break-all font-mono text-xs text-[#555b66]">
                            {event.providerEventId}
                          </p>
                        </div>
                        <div className="shrink-0 border-l-2 border-[#0757ff] pl-3">
                          <p className="font-mono text-2xl font-bold tabular-nums">
                            {event.deliveryCount}
                          </p>
                          <p className="text-xs text-[#555b66]">deliveries</p>
                          <p className="mt-2 font-mono text-xs font-bold text-[#555b66]">
                            {event.processingAttempts} worker attempt
                            {event.processingAttempts === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      {event.processingError ? (
                        <p className="mt-4 border-l-4 border-[#f4a000] bg-[#fff8e5] p-3 text-sm leading-6 text-[#654600]">
                          {event.processingError}
                        </p>
                      ) : null}
                      <dl className="mt-4 grid gap-3 border-t border-[#d7dbe2] pt-4 text-xs sm:grid-cols-3">
                        <Fact label="Provider" value={event.provider} />
                        <Fact
                          label="First received"
                          value={formatDate(event.receivedAt)}
                        />
                        <Fact
                          label="Last received"
                          value={formatDate(event.lastReceivedAt)}
                        />
                        <Fact
                          label="Queued"
                          value={
                            event.queuedAt
                              ? formatDate(event.queuedAt)
                              : 'Not queued'
                          }
                        />
                      </dl>
                    </li>
                  ))}
                </ul>
                <Paginator data={data} onPage={setPage} />
              </div>
            ) : (
              <EmptyState label="No webhook events match these filters." />
            )
          }
        </ResourceList>
      </div>
    </div>
  );
}

function QueuePanel({ token }: { token: string }) {
  const resource = useAdminResource<AdminWebhookQueue>(
    '/admin/queues/webhooks',
    token,
  );

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PanelHeading eyebrow="BullMQ / Redis" title="Webhook retry queue" />
        <button
          className={pageButtonClass}
          onClick={resource.refresh}
          type="button"
        >
          Refresh queue
        </button>
      </div>
      <div className="mt-6">
        <ResourceList resource={resource} title="webhook queue">
          {(data) => (
            <div>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {['waiting', 'active', 'delayed', 'failed'].map((state) => (
                  <div
                    className={`border p-4 ${
                      state === 'failed'
                        ? 'border-[#efb6be] bg-[#fff7f8]'
                        : 'border-[#cdd2d9] bg-[#f8f9fb]'
                    }`}
                    key={state}
                  >
                    <dt className="text-xs font-bold tracking-[0.08em] text-[#555b66] uppercase">
                      {state}
                    </dt>
                    <dd className="mt-3 font-mono text-3xl font-bold tabular-nums">
                      {data.counts[state] ?? 0}
                    </dd>
                  </div>
                ))}
              </dl>

              {data.jobs.length > 0 ? (
                <ul className="mt-6 grid gap-3">
                  {data.jobs.map((job) => (
                    <li
                      className="border border-[#d7dbe2] p-4 sm:p-5"
                      key={job.id}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <StatusPill value={job.state.toUpperCase()} />
                          <p className="mt-3 break-all font-mono text-xs text-[#555b66]">
                            Event {job.webhookEventId}
                          </p>
                        </div>
                        <div className="shrink-0 border-l-2 border-[#0757ff] pl-3 text-right">
                          <p className="font-mono text-2xl font-bold tabular-nums">
                            {job.attemptsMade} / {job.attemptsTotal}
                          </p>
                          <p className="text-xs text-[#555b66]">attempts</p>
                        </div>
                      </div>
                      {job.failedReason ? (
                        <p
                          className="mt-4 border-l-4 border-[#b42335] bg-[#fff0f2] p-3 text-sm leading-6 text-[#7e1d2c]"
                          role="status"
                        >
                          {job.failedReason}
                        </p>
                      ) : null}
                      <dl className="mt-4 grid gap-3 border-t border-[#d7dbe2] pt-4 text-xs sm:grid-cols-3">
                        <Fact label="Job ID" value={job.id} />
                        <Fact
                          label="Created"
                          value={formatDate(job.timestamp)}
                        />
                        <Fact
                          label="Finished"
                          value={
                            job.finishedAt
                              ? formatDate(job.finishedAt)
                              : 'In progress'
                          }
                        />
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-6">
                  <EmptyState label="No retained webhook jobs are visible." />
                </div>
              )}
            </div>
          )}
        </ResourceList>
      </div>
    </div>
  );
}

function AuditPanel({ token }: { token: string }) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const path = useMemo(
    () =>
      endpoint('/admin/audit-logs', {
        action: action || undefined,
        page,
        pageSize: 10,
      }),
    [action, page],
  );
  const resource = useAdminResource<AdminPage<AdminAuditLog>>(path, token);

  return (
    <div>
      <PanelHeading eyebrow="Who, why, what, and when" title="Audit log" />
      <FilterBar onSubmit={() => setPage(1)}>
        <FilterText
          label="Exact action"
          onChange={(value) => {
            setAction(value.trim());
            setPage(1);
          }}
          placeholder="REFUND_REQUESTED"
          value={action}
        />
      </FilterBar>
      <div className="mt-6">
        <ResourceList resource={resource} title="audit logs">
          {(data) =>
            data.items.length > 0 ? (
              <div>
                <ol className="relative grid gap-4 border-l border-[#aeb4bf] pl-5 sm:pl-8">
                  {data.items.map((log) => (
                    <li
                      className="relative border border-[#d7dbe2] bg-white p-4 before:absolute before:top-6 before:-left-[25px] before:h-2 before:w-2 before:rounded-full before:bg-[#0757ff] sm:p-5 sm:before:-left-[37px]"
                      key={log.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm font-bold text-[#0757ff]">
                            {log.action}
                          </p>
                          <p className="mt-2 text-sm text-[#555b66]">
                            {log.actorEmail ?? 'PayFlow system'} ·{' '}
                            {log.actorType}
                          </p>
                        </div>
                        <time
                          className="text-xs text-[#555b66]"
                          dateTime={log.createdAt}
                        >
                          {formatDate(log.createdAt)}
                        </time>
                      </div>
                      <p className="mt-4 break-all font-mono text-xs">
                        {log.targetType} / {log.targetId}
                      </p>
                      <details className="mt-4 border-t border-[#d7dbe2] pt-3">
                        <summary className="cursor-pointer text-sm font-bold text-[#555b66] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]">
                          Metadata
                        </summary>
                        <pre className="mt-3 max-w-full overflow-x-auto bg-[#080a0f] p-3 text-xs leading-5 text-[#d9e3f8]">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
                <Paginator data={data} onPage={setPage} />
              </div>
            ) : (
              <EmptyState label="No audit entries match this action." />
            )
          }
        </ResourceList>
      </div>
    </div>
  );
}

function OrderDetailCard({ order }: { order: AdminOrderDetail }) {
  return (
    <div>
      <StatusPill value={order.status} />
      <p className="mt-4 break-all font-mono text-sm font-bold">
        {order.orderNo}
      </p>
      <p className="mt-2 text-sm text-[#555b66]">{order.customerEmail}</p>
      <p className="mt-4 text-3xl font-bold tabular-nums">
        {formatMoney(order.totalAmount, order.currency)}
      </p>
      <h3 className="mt-7 border-b border-[#080a0f] pb-2 font-bold">Items</h3>
      <ul className="divide-y divide-[#d7dbe2]">
        {order.items.map((item) => (
          <li className="py-3 text-sm" key={item.id}>
            <div className="flex justify-between gap-3">
              <span className="font-bold">{item.name}</span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(item.lineTotalAmount, order.currency)}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-[#555b66]">
              {item.sku} · {item.quantity} ×{' '}
              {formatMoney(item.unitPriceAmount, order.currency)}
            </p>
          </li>
        ))}
      </ul>
      <h3 className="mt-7 border-b border-[#080a0f] pb-2 font-bold">
        Payments
      </h3>
      <ul className="divide-y divide-[#d7dbe2]">
        {order.payments.map((payment) => (
          <li className="py-3" key={payment.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusPill value={payment.status} />
              <span className="font-bold tabular-nums">
                {formatMoney(payment.amount, payment.currency)}
              </span>
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-[#555b66]">
              {payment.providerPaymentId ?? payment.id}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentDetailCard({ payment }: { payment: AdminPaymentDetail }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <StatusPill value={payment.status} />
        <StatusPill value={payment.provider} />
      </div>
      <p className="mt-4 text-3xl font-bold tabular-nums">
        {formatMoney(payment.amount, payment.currency)}
      </p>
      <p className="mt-3 break-all font-mono text-xs text-[#555b66]">
        {payment.providerPaymentId ?? 'Provider PaymentIntent pending'}
      </p>
      <dl className="mt-5 grid gap-3 border-y border-[#d7dbe2] py-4 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <Fact label="Order" value={payment.orderNo} />
        <Fact label="Customer" value={payment.customerEmail} />
        <Fact
          label="Refunded"
          value={formatMoney(payment.refundedAmount, payment.currency)}
        />
        <Fact
          label="Reserved"
          value={formatMoney(payment.reservedRefundAmount, payment.currency)}
        />
      </dl>
      <h3 className="mt-7 border-b border-[#080a0f] pb-2 font-bold">
        Provider attempts
      </h3>
      {payment.attempts.length > 0 ? (
        <ul className="divide-y divide-[#d7dbe2]">
          {payment.attempts.map((attempt) => (
            <li className="py-3 text-sm" key={attempt.id}>
              <div className="flex items-center justify-between gap-3">
                <StatusPill value={attempt.status} />
                <time
                  className="text-xs text-[#555b66]"
                  dateTime={attempt.createdAt}
                >
                  {formatDate(attempt.createdAt)}
                </time>
              </div>
              {attempt.errorMessage ? (
                <p className="mt-2 text-xs leading-5 text-[#8b2635]">
                  {attempt.errorCode}: {attempt.errorMessage}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-[#555b66]">No provider attempts.</p>
      )}
      <h3 className="mt-7 border-b border-[#080a0f] pb-2 font-bold">Refunds</h3>
      {payment.refunds.length > 0 ? (
        <ul className="divide-y divide-[#d7dbe2]">
          {payment.refunds.map((refund) => (
            <li className="py-3" key={refund.id}>
              <div className="flex items-center justify-between gap-3">
                <StatusPill value={refund.status} />
                <span className="font-bold tabular-nums">
                  {formatMoney(refund.amount, refund.currency)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#555b66]">
                {refund.reason}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-[#555b66]">No refunds.</p>
      )}
    </div>
  );
}

function RefundCard({ refund }: { refund: AdminRefund }) {
  return (
    <li className="border border-[#d7dbe2] p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <StatusPill value={refund.status} />
          <p className="mt-3 break-all font-mono text-xs font-bold">
            {refund.providerRefundId ?? 'Provider confirmation pending'}
          </p>
          <p className="mt-2 text-sm text-[#555b66]">
            {refund.orderNo} · {refund.customerEmail}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums sm:text-right">
          {formatMoney(refund.amount, refund.currency)}
        </p>
      </div>
      <p className="mt-4 border-l-2 border-[#aeb4bf] pl-3 text-sm leading-6">
        {refund.reason}
      </p>
      {refund.failureMessage ? (
        <p className="mt-3 bg-[#fff0f2] p-3 text-sm text-[#7e1d2c]">
          {refund.failureCode}: {refund.failureMessage}
        </p>
      ) : null}
      <time
        className="mt-4 block text-xs text-[#555b66]"
        dateTime={refund.updatedAt}
      >
        Updated {formatDate(refund.updatedAt)}
      </time>
    </li>
  );
}

function RefundResult({ result }: { result: CreateRefundResponse }) {
  return (
    <div className="border-l-4 border-[#08ae8c] bg-[#edf9f6] p-4" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          {result.reused ? 'Existing refund reused' : 'Refund accepted'}
        </p>
        <StatusPill value={result.refund.status} />
      </div>
      <p className="mt-2 break-all font-mono text-xs text-[#43635c]">
        {result.refund.providerRefundId ?? result.refund.id}
      </p>
    </div>
  );
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-[#080a0f] pb-5">
      <p className="font-mono text-xs font-bold tracking-[0.13em] text-[#0757ff] uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

function FilterBar({
  children,
  onSubmit,
}: {
  children: React.ReactNode;
  onSubmit: () => void;
}) {
  return (
    <form
      className="mt-5 flex flex-col gap-3 border border-[#d7dbe2] bg-[#f8f9fb] p-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <button
        className="min-h-11 rounded-md bg-[#080a0f] px-5 text-sm font-bold text-white hover:bg-[#272b33] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
        type="submit"
      >
        Apply
      </button>
    </form>
  );
}

function FilterText({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="grid min-w-0 flex-1 gap-1.5 text-xs font-bold text-[#555b66]">
      {label}
      <input
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function FilterSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[#555b66]">
      {label}
      <select
        className={`${inputClass} min-w-48`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function FieldLabel({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold">
      {label}
      {children}
    </label>
  );
}

function DetailRail({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <aside className="self-start border border-[#080a0f] bg-[#f8f9fb] p-5 sm:p-6 xl:sticky xl:top-6">
      <p className="mb-5 border-b border-[#080a0f] pb-3 font-mono text-xs font-bold tracking-[0.1em] uppercase">
        {title}
      </p>
      {children}
    </aside>
  );
}

function ResourceList<T>({
  children,
  resource,
  title,
}: {
  children: (data: T) => React.ReactNode;
  resource: ReturnType<typeof useAdminResource<T>>;
  title: string;
}) {
  return resource.state.status === 'ready' ? (
    children(resource.state.data)
  ) : (
    <ResourceStateView resource={resource} title={title} />
  );
}

function ResourceStateView<T>({
  compact = false,
  resource,
  title,
}: {
  compact?: boolean;
  resource: ReturnType<typeof useAdminResource<T>>;
  title: string;
}) {
  if (resource.state.status === 'error') {
    return (
      <div
        className="border-l-4 border-[#b42335] bg-[#fff0f2] p-5"
        role="alert"
      >
        <p className="font-bold">Could not load {title}.</p>
        <p className="mt-2 text-sm leading-6 text-[#7e1d2c]">
          {resource.state.message}
        </p>
        <button
          className="mt-4 min-h-10 rounded-md border border-[#b42335] px-4 text-sm font-bold text-[#7e1d2c] hover:bg-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]"
          onClick={resource.refresh}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      aria-label={`Loading ${title}`}
      aria-live="polite"
      className={`animate-pulse bg-[#eef1f5] ${compact ? 'h-52' : 'h-72'}`}
      role="status"
    >
      <span className="sr-only">Loading {title}…</span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-[#aeb4bf] bg-[#f8f9fb] px-5 py-12 text-center text-sm leading-6 text-[#555b66]">
      {label}
    </div>
  );
}

function Paginator<T>({
  data,
  onPage,
}: {
  data: AdminPage<T>;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#080a0f] pt-4"
    >
      <p className="text-xs text-[#555b66]">
        Page {data.page} of {Math.max(data.totalPages, 1)} · {data.total}{' '}
        records
      </p>
      <div className="flex gap-2">
        <button
          className={pageButtonClass}
          disabled={data.page <= 1}
          onClick={() => onPage(data.page - 1)}
          type="button"
        >
          Previous
        </button>
        <button
          className={pageButtonClass}
          disabled={data.totalPages === 0 || data.page >= data.totalPages}
          onClick={() => onPage(data.page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone =
    value.includes('FAILED') || value === 'CANCELLED'
      ? 'bg-[#fff0f2] text-[#8b2635] border-[#efb6be]'
      : value.includes('PENDING') || value === 'PROCESSING'
        ? 'bg-[#fff8e5] text-[#654600] border-[#f1ca72]'
        : value.includes('SUCCEEDED') ||
            value.includes('REFUNDED') ||
            value === 'PAID' ||
            value === 'PROCESSED'
          ? 'bg-[#edf9f6] text-[#087f6a] border-[#80cdbd]'
          : 'bg-[#eef1f5] text-[#3f4652] border-[#cdd2d9]';

  return (
    <span
      className={`inline-flex min-h-7 items-center border px-2 font-mono text-[10px] font-bold tracking-[0.06em] uppercase ${tone}`}
    >
      {humanize(value)}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-bold text-[#555b66]">{label}</dt>
      <dd className="mt-1 break-all font-mono text-[#080a0f]">{value}</dd>
    </div>
  );
}

function useAdminResource<T>(
  path: string | null,
  token: string,
  externalRevision = 0,
): {
  refresh: () => void;
  state: ResourceState<T>;
} {
  const [revision, setRevision] = useState(0);
  const requestKey = `${path ?? ''}:${externalRevision}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    state: ResourceState<T>;
  }>({ key: '', state: { status: 'idle' } });

  useEffect(() => {
    if (!path) {
      return;
    }

    const controller = new AbortController();
    apiRequest<T>(path, { signal: controller.signal, token })
      .then((data) =>
        setResult({ key: requestKey, state: { data, status: 'ready' } }),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setResult({
          key: requestKey,
          state: {
            message:
              error instanceof ApiError
                ? `${error.message} (${error.code})`
                : 'The API is unavailable.',
            status: 'error',
          },
        });
      });

    return () => controller.abort();
  }, [path, requestKey, token]);

  return {
    refresh: () => setRevision((value) => value + 1),
    state:
      path === null
        ? { status: 'idle' }
        : result.key === requestKey
          ? result.state
          : { status: 'loading' },
  };
}

function endpoint(
  path: string,
  parameters: Record<string, number | string | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  return `${path}?${search.toString()}`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const inputClass =
  'min-h-11 w-full rounded-md border border-[#aeb4bf] bg-white px-3 py-2 text-sm text-[#080a0f] outline-none placeholder:text-[#858b95] focus:border-[#0757ff] focus:ring-3 focus:ring-[#0757ff]/15';
const pageButtonClass =
  'min-h-10 rounded-md border border-[#aeb4bf] px-4 text-sm font-bold hover:border-[#080a0f] hover:bg-[#f5f7fa] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]';
