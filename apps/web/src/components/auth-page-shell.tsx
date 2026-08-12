export function AuthPageShell({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: 'login' | 'register';
}) {
  return (
    <main className="bg-[#f8f9fb]" id="main-content">
      <div className="mx-auto grid min-h-[calc(100vh-170px)] max-w-[1240px] gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(380px,500px)] lg:items-center lg:px-16 lg:py-20">
        <div className="max-w-[590px]">
          <p className="font-mono text-xs font-bold tracking-[0.15em] text-[#0757ff] uppercase">
            Identity boundary / Stage 1
          </p>
          <h2 className="mt-5 text-[clamp(2.8rem,6vw,5.7rem)] leading-[0.9] font-bold tracking-[-0.07em]">
            {mode === 'login'
              ? 'Continue with an explicit role.'
              : 'Start as a sandbox user.'}
          </h2>
          <p className="mt-7 max-w-lg text-lg leading-8 text-[#555b66]">
            Public registration always creates a USER. ADMIN access comes only
            from the controlled database seed—never from this form.
          </p>
          <dl className="mt-10 grid gap-px overflow-hidden border border-[#cdd2d9] bg-[#cdd2d9] sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <BoundaryFact label="Password" value="bcrypt / cost 12" />
            <BoundaryFact label="Session" value="JWT / HS256" />
            <BoundaryFact label="Roles" value="USER / ADMIN" />
          </dl>
        </div>
        {children}
      </div>
    </main>
  );
}

function BoundaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <dt className="text-xs font-semibold text-[#6a707b] uppercase">
        {label}
      </dt>
      <dd className="mt-2 font-mono text-sm font-bold">{value}</dd>
    </div>
  );
}
