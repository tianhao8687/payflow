export default function LoadingPaymentResultRoute() {
  return (
    <main id="main-content">
      <div
        className="mx-auto max-w-[860px] px-5 py-20 sm:px-8"
        aria-busy="true"
        aria-label="Loading local payment status"
        role="status"
      >
        <div className="h-3 w-40 animate-pulse rounded bg-[#e1e5eb]" />
        <div className="mt-5 h-14 w-3/4 animate-pulse rounded bg-[#e1e5eb]" />
        <div className="mt-10 h-64 animate-pulse bg-[#eef1f5]" />
        <span className="sr-only">Loading local payment status…</span>
      </div>
    </main>
  );
}
