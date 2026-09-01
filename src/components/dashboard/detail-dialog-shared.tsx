import type { ReactNode } from "react";

export const DIALOG_EXIT_MS = 260;

export function InlineSkeleton() {
  return <span className="inline-block h-4 w-24 rounded-full align-middle ds-skeleton" />;
}

export function DataCard({ label, value, subValue }: { label: string; value: ReactNode; subValue: string }) {
  return (
    <article className="ds-card-muted px-4 py-3.5">
      <p className="ds-kicker text-[0.58rem] text-[var(--foreground-faint)]">{label}</p>
      <p className="mt-3 break-words ds-mono text-[0.92rem] font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-[1rem]">
        {value}
      </p>
      <p className="mt-2 text-[0.72rem] text-[var(--foreground-soft)]">{subValue}</p>
    </article>
  );
}

export function BreakdownPanel({ loading = false, title, emptyText, rows }: {
  loading?: boolean;
  title: string;
  emptyText: string;
  rows: Array<{
    key: string;
    title: string;
    metric: ReactNode;
    subMetric: ReactNode;
    meta: string;
  }>;
}) {
  return (
    <section className="ds-card px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-[0.92rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">{title}</h4>
        <span className="ds-kicker text-[0.56rem] text-[var(--foreground-faint)]">按总令牌排序</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <article key={index} className="ds-card-muted px-4 py-3.5">
              <div className="ds-skeleton h-4 w-36 rounded-full" />
              <div className="mt-3 ds-skeleton h-4 w-24 rounded-full" />
              <div className="mt-3 ds-skeleton h-3 w-48 rounded-full" />
            </article>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--foreground-soft)]">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <article key={row.key} className="ds-card-muted ds-card-interactive px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</p>
                  <h5 className="mt-2 break-words text-[0.88rem] font-semibold text-[var(--foreground)]">{row.title}</h5>
                </div>
                <div className="shrink-0 text-right">
                  <p className="ds-mono text-[0.88rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">{row.metric}</p>
                  <p className="mt-1 text-[0.68rem] text-[var(--foreground-soft)]">{row.subMetric}</p>
                </div>
              </div>
              <p className="mt-3 text-[0.72rem] text-[var(--foreground-soft)]">{row.meta}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
