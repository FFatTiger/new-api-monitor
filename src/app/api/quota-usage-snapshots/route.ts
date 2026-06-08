import { NextRequest, NextResponse } from "next/server";

import { aggregateProviderQuotaSnapshot } from "@/lib/quota/usage-aggregation";
import { recordQuotaSnapshots } from "@/lib/queries/quota-usage-prediction";
import { resolveProviderType } from "@/lib/quota/upstream";
import type { ProviderType, QuotaData } from "@/types/quota";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SnapshotRequest = {
  providers?: Array<{ provider?: ProviderType; data?: QuotaData[] }>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SnapshotRequest;
    const snapshots = (body.providers || [])
      .map((entry) => {
        const provider = resolveProviderType({ type: entry.provider }) as ProviderType;
        return provider !== "unknown" && Array.isArray(entry.data)
          ? aggregateProviderQuotaSnapshot(provider, entry.data)
          : null;
      })
      .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));

    const result = await recordQuotaSnapshots(snapshots);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error: unknown) {
    console.error("Failed to record quota usage snapshots", error);
    return NextResponse.json(
      { error: "Failed to record quota usage snapshots" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
