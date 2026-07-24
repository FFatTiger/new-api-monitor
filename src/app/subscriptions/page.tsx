import { AppHeader } from "@/components/navigation/app-header";
import { SubscriptionShareChart } from "@/components/subscriptions/subscription-share-chart";
import { SubscriptionsSummary } from "@/components/subscriptions/subscriptions-summary";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { formatDateTime } from "@/lib/format";
import { getSubscriptionsOverview } from "@/lib/queries/subscriptions";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const { summary, rows, generatedAt } = await getSubscriptionsOverview();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AppHeader
        timestamp={formatDateTime(generatedAt)}
        subtitle="查看所有用户订阅额度与消耗占比。"
      />

      <SubscriptionsSummary summary={summary} />

      <SubscriptionShareChart rows={rows} />

      <SubscriptionsTable rows={rows} now={generatedAt} />
    </main>
  );
}
