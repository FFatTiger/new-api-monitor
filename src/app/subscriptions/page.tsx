import { AppHeader } from "@/components/navigation/app-header";
import { SubscriptionBillingHeaderControls } from "@/components/subscriptions/subscription-billing-filters";
import { SubscriptionShareChart } from "@/components/subscriptions/subscription-share-chart";
import { SubscriptionsSummary } from "@/components/subscriptions/subscriptions-summary";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { formatDateTime } from "@/lib/format";
import {
  parseSubscriptionBillingFilters,
  type SubscriptionBillingSearchParams,
} from "@/lib/queries/subscription-billing-filters";
import { getSubscriptionsOverview } from "@/lib/queries/subscriptions";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<SubscriptionBillingSearchParams> };

export default async function SubscriptionsPage({ searchParams }: PageProps) {
  const resolved = await searchParams;
  const filters = parseSubscriptionBillingFilters(resolved);
  const { summary, rows, generatedAt } = await getSubscriptionsOverview(filters);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AppHeader
        timestamp={formatDateTime(generatedAt)}
        controls={<SubscriptionBillingHeaderControls filters={filters} />}
        subtitle="按所选时间范围查看订阅计费消费与用户占比。"
      />

      <section className="-mt-5 space-y-1 sm:-mt-7">
        <p className="text-[0.72rem] text-[var(--foreground-soft)]">
          所选时间范围订阅消费：
          <span className="ml-1 font-medium text-[var(--foreground)]">{filters.windowLabel}</span>
        </p>
        {filters.validationMessage ? (
          <p role="status" className="text-[0.72rem] text-amber-600 dark:text-amber-400">
            {filters.validationMessage}
          </p>
        ) : null}
      </section>

      <SubscriptionsSummary summary={summary} />

      <SubscriptionShareChart rows={rows} windowLabel={filters.windowLabel} />

      <SubscriptionsTable rows={rows} windowLabel={filters.windowLabel} />
    </main>
  );
}
