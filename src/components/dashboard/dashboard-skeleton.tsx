function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`ds-skeleton rounded-full ${className}`} />;
}

function SummarySkeleton() {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <SkeletonBlock className="h-3 w-20" />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <article key={index} className="ds-card-muted px-4 py-3.5 sm:px-4 sm:py-4">
            <SkeletonBlock className="h-3 w-20" />
            <div className="mt-4 flex items-end justify-between gap-3">
              <SkeletonBlock className="h-6 w-24" />
              <SkeletonBlock className="h-3 w-10" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TableSkeleton({ titleWidth = "w-36" }: { titleWidth?: string }) {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className={`mt-3 h-7 ${titleWidth}`} />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBlock key={index} className="h-8 w-24" />
          ))}
        </div>
      </div>
      <div className="ds-table-shell hidden lg:block">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="ds-table-row grid grid-cols-[4rem_minmax(0,1.4fr)_minmax(0,1fr)_repeat(4,minmax(6rem,0.7fr))] gap-4 px-4 py-4">
            <SkeletonBlock className="h-4 w-8" />
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-16" />
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="h-4 w-16" />
            <SkeletonBlock className="h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <article key={index} className="ds-mobile-row px-4 py-4">
            <SkeletonBlock className="h-4 w-3/4" />
            <div className="mt-4 grid grid-cols-3 gap-3">
              <SkeletonBlock className="h-5 w-full" />
              <SkeletonBlock className="h-5 w-full" />
              <SkeletonBlock className="h-5 w-full" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TrendSkeleton() {
  return (
    <section className="ds-panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="mt-3 h-7 w-32" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-8 w-20" />
          <SkeletonBlock className="h-8 w-20" />
          <SkeletonBlock className="h-8 w-24" />
        </div>
      </div>
      <div className="h-60 rounded-[18px] bg-[var(--background-elevated)] p-4 shadow-[0_0_0_1px_var(--surface-ring-soft)] sm:h-72">
        <div className="flex h-full flex-col justify-between">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} className="h-2 w-full" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10" aria-busy="true" aria-label="数据刷新中">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="mt-4 h-12 w-64 sm:w-80" />
          <SkeletonBlock className="mt-4 h-4 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-10 w-28 rounded-[12px]" />
          <SkeletonBlock className="h-10 w-10 rounded-[12px]" />
        </div>
      </header>

      <SummarySkeleton />
      <TableSkeleton />
      <TableSkeleton titleWidth="w-40" />
      <TrendSkeleton />
    </main>
  );
}
