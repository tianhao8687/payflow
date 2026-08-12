'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  apiRequest,
  formatMoney,
  type AdminIntegrity,
  type AdminLedgerTransaction,
  type AdminReconciliationIssue,
} from '@/lib/api';

type LoadState =
  | { status: 'loading' }
  | { data: AdminIntegrity; status: 'ready' }
  | { message: string; status: 'error' };

export function IntegrityPanel({ token }: { token: string }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<AdminIntegrity>('/admin/integrity', {
      signal: controller.signal,
      token,
    })
      .then((data) => setState({ data, status: 'ready' }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState({
          message:
            error instanceof ApiError
              ? `${error.message} (${error.code})`
              : 'The integrity API is unavailable.',
          status: 'error',
        });
      });
    return () => controller.abort();
  }, [revision, token]);

  async function resolveIssue(issue: AdminReconciliationIssue): Promise<void> {
    setNotice(null);
    setResolvingId(issue.id);
    try {
      await apiRequest(
        `/admin/reconciliation/issues/${encodeURIComponent(issue.id)}/resolve`,
        { method: 'PATCH', token },
      );
      setNotice(`${humanize(issue.issueType)} marked resolved.`);
      refresh();
    } catch (error: unknown) {
      setNotice(
        error instanceof ApiError
          ? `${error.message} (${error.code})`
          : 'The issue could not be resolved.',
      );
    } finally {
      setResolvingId(null);
    }
  }

  if (state.status === 'loading') {
    return (
      <div
        aria-busy="true"
        aria-label="Loading financial integrity data"
        className="grid animate-pulse gap-4 sm:grid-cols-2"
      >
        <div className="h-48 bg-[#eef1f5]" />
        <div className="h-48 bg-[#eef1f5]" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        className="border-l-4 border-[#b42335] bg-[#fff0f2] p-5"
        role="alert"
      >
        <p className="font-bold">Could not load financial integrity data.</p>
        <p className="mt-2 text-sm text-[#7e1d2c]">{state.message}</p>
        <button className={secondaryButton} onClick={refresh} type="button">
          Retry
        </button>
      </div>
    );
  }

  const integrity = state.data;
  const openIssues = integrity.reconciliationIssues.filter(
    (issue) => issue.status === 'OPEN',
  );

  return (
    <div>
      <header className="border-b border-[#080a0f] pb-5">
        <p className="font-mono text-xs font-bold tracking-[0.13em] text-[#0757ff] uppercase">
          Stage 09 / Financial integrity
        </p>
        <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
          Outbox, ledger & reconciliation
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#555b66]">
          Follow each committed money event from durable delivery to balanced
          entries, then compare local state with the sandbox provider.
        </p>
      </header>

      <p
        aria-live="polite"
        className="mt-4 min-h-6 text-sm font-semibold text-[#087f6a]"
      >
        {notice}
      </p>

      <section aria-labelledby="reconciliation-heading" className="mt-4">
        <SectionHeading
          id="reconciliation-heading"
          meta={`${openIssues.length} open`}
          title="Reconciliation issues"
        />
        {openIssues.length > 0 ? (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {openIssues.map((issue) => (
              <IssueCard
                issue={issue}
                key={issue.id}
                onResolve={() => void resolveIssue(issue)}
                resolving={resolvingId === issue.id}
              />
            ))}
          </ul>
        ) : (
          <EmptyState label="No open provider differences. Completed checks are retained below." />
        )}
      </section>

      <section aria-labelledby="ledger-heading" className="mt-10">
        <SectionHeading
          id="ledger-heading"
          meta={`${integrity.ledgerTransactions.length} retained`}
          title="Double-entry ledger"
        />
        {integrity.ledgerTransactions.length > 0 ? (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {integrity.ledgerTransactions.map((transaction) => (
              <LedgerCard key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        ) : (
          <EmptyState label="No payment or refund events have posted to the ledger yet." />
        )}
      </section>

      <section aria-labelledby="outbox-heading" className="mt-10">
        <SectionHeading
          id="outbox-heading"
          meta={`${integrity.outboxEvents.length} retained`}
          title="Transactional outbox"
        />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['PENDING', 'PUBLISHED', 'PROCESSED', 'FAILED'] as const).map(
            (status) => (
              <div
                className="border border-[#cdd2d9] bg-[#f8f9fb] p-4"
                key={status}
              >
                <p className="font-mono text-[10px] font-bold tracking-[0.08em] text-[#555b66]">
                  {status}
                </p>
                <p className="mt-2 text-3xl font-bold tabular-nums">
                  {integrity.outboxCounts[status] ?? 0}
                </p>
              </div>
            ),
          )}
        </div>
        {integrity.outboxEvents.length > 0 ? (
          <ol className="mt-4 divide-y divide-[#d7dbe2] border border-[#d7dbe2]">
            {integrity.outboxEvents.map((event) => (
              <li
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={event.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Status value={event.status} />
                    <span className="font-mono text-xs font-bold">
                      {event.eventType}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] text-[#555b66]">
                    {event.eventKey}
                  </p>
                  {event.lastError ? (
                    <p className="mt-2 text-xs leading-5 text-[#7e1d2c]">
                      {event.lastError}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-[#555b66] sm:text-right">
                  Publish {event.publishAttempts} · Process{' '}
                  {event.processingAttempts}
                  <br />
                  {formatDate(event.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState label="No domain events are waiting for publication." />
        )}
      </section>

      <section aria-labelledby="runs-heading" className="mt-10">
        <SectionHeading
          id="runs-heading"
          meta={`${integrity.reconciliationRuns.length} retained`}
          title="Scheduled runs"
        />
        {integrity.reconciliationRuns.length > 0 ? (
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {integrity.reconciliationRuns.map((run) => (
              <li className="border border-[#d7dbe2] p-4" key={run.id}>
                <div className="flex items-center justify-between gap-3">
                  <Status value={run.status} />
                  <time
                    className="text-xs text-[#555b66]"
                    dateTime={run.startedAt}
                  >
                    {formatDate(run.startedAt)}
                  </time>
                </div>
                <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-[#d7dbe2] pt-4 text-center text-xs">
                  <RunFact label="Checked" value={run.checkedCount} />
                  <RunFact label="Passed" value={run.passedCount} />
                  <RunFact label="Issues" value={run.issueCount} />
                  <RunFact label="Errors" value={run.errorCount} />
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState label="The reconciliation scheduler has not completed a run yet." />
        )}
      </section>
    </div>
  );
}

function IssueCard({
  issue,
  onResolve,
  resolving,
}: {
  issue: AdminReconciliationIssue;
  onResolve: () => void;
  resolving: boolean;
}) {
  return (
    <li className="border-l-4 border-[#b42335] bg-[#fff7f8] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Status value={issue.status} />
          <p className="mt-3 font-mono text-sm font-bold text-[#8b2635]">
            {humanize(issue.issueType)}
          </p>
          <p className="mt-2 text-sm text-[#555b66]">
            {issue.orderNo} · {issue.provider} · {issue.customerEmail}
          </p>
        </div>
        <button
          className={secondaryButton}
          disabled={resolving}
          onClick={onResolve}
          type="button"
        >
          {resolving ? 'Resolving…' : 'Mark resolved'}
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Snapshot label="Local" value={issue.localSnapshot} />
        <Snapshot label="Provider" value={issue.providerSnapshot} />
      </div>
      <p className="mt-3 text-xs text-[#555b66]">
        Last seen {formatDate(issue.lastSeenAt)}
      </p>
    </li>
  );
}

function LedgerCard({ transaction }: { transaction: AdminLedgerTransaction }) {
  return (
    <li className="border border-[#d7dbe2] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Status value={transaction.transactionType} />
          <Status
            value={transaction.balance === 0 ? 'BALANCED' : 'UNBALANCED'}
          />
        </div>
        <time
          className="text-xs text-[#555b66]"
          dateTime={transaction.createdAt}
        >
          {formatDate(transaction.createdAt)}
        </time>
      </div>
      <p className="mt-3 break-all font-mono text-[11px] text-[#555b66]">
        {transaction.referenceType} / {transaction.referenceId}
      </p>
      <ul className="mt-4 divide-y divide-[#d7dbe2] border-y border-[#d7dbe2]">
        {transaction.entries.map((entry) => (
          <li
            className="flex items-center justify-between gap-3 py-3 text-sm"
            key={entry.id}
          >
            <div>
              <p className="font-bold">{entry.accountName}</p>
              <p className="mt-1 font-mono text-[10px] text-[#555b66]">
                {entry.accountCode}
              </p>
            </div>
            <p className="shrink-0 text-right font-mono font-bold tabular-nums">
              {entry.direction === 'DEBIT' ? '+' : '−'}
              {formatMoney(entry.amount, entry.currency)}
              <span className="mt-1 block text-[10px] text-[#555b66]">
                {entry.direction}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Snapshot({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  return (
    <div className="min-w-0 border border-[#d7dbe2] bg-white p-3">
      <p className="text-xs font-bold text-[#555b66]">{label}</p>
      <pre className="mt-2 overflow-x-auto font-mono text-[10px] leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function SectionHeading({
  id,
  meta,
  title,
}: {
  id: string;
  meta: string;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#080a0f] pb-3">
      <h3 className="text-xl font-bold" id={id}>
        {title}
      </h3>
      <p className="font-mono text-xs text-[#555b66]">{meta}</p>
    </div>
  );
}

function RunFact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[#555b66]">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-bold">{value}</dd>
    </div>
  );
}

function Status({ value }: { value: string }) {
  const alert =
    value.includes('FAILED') || value === 'OPEN' || value === 'UNBALANCED';
  const healthy =
    value === 'PROCESSED' ||
    value === 'COMPLETED' ||
    value === 'BALANCED' ||
    value === 'RESOLVED';
  return (
    <span
      className={`inline-flex min-h-7 items-center border px-2 font-mono text-[10px] font-bold tracking-[0.06em] uppercase ${alert ? 'border-[#efb6be] bg-[#fff0f2] text-[#8b2635]' : healthy ? 'border-[#80cdbd] bg-[#edf9f6] text-[#087f6a]' : 'border-[#cdd2d9] bg-[#eef1f5] text-[#3f4652]'}`}
    >
      {humanize(value)}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="mt-4 border border-dashed border-[#aeb4bf] bg-[#f8f9fb] px-5 py-10 text-center text-sm leading-6 text-[#555b66]">
      {label}
    </div>
  );
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

const secondaryButton =
  'mt-4 min-h-10 rounded-md border border-[#080a0f] px-4 text-sm font-bold text-[#080a0f] hover:bg-[#080a0f] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#0757ff]';
