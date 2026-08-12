export default function LoadingOrderRoute() {
  return (
    <main id="main-content">
      <div
        className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 lg:px-16"
        aria-busy="true"
        aria-label="Loading order"
        role="status"
      >
        <div className="h-5 w-32 animate-pulse rounded bg-[#e1e5eb]" />
        <div className="mt-8 h-52 animate-pulse bg-[#eef1f5]" />
        <div className="mt-4 h-72 animate-pulse bg-[#eef1f5]" />
        <span className="sr-only">Loading order…</span>
      </div>
    </main>
  );
}
