import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = process.env.API_BASE_URL || "";
const API_MANAGEMENT_KEY = process.env.API_MANAGEMENT_KEY || "";

type UsageDetail = {
  auth_index?: number | string;
  failed?: boolean;
};

type UsageModelEntry = {
  details?: UsageDetail[];
};

type UsageApiEntry = {
  models?: Record<string, UsageModelEntry>;
};

type UsagePayload = {
  apis?: Record<string, UsageApiEntry>;
  usage?: UsagePayload;
};

const normalizeAuthIndex = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  return null;
};

const computeAuthIndexStats = (usageData: UsagePayload | null | undefined) => {
  const payload = usageData?.usage ?? usageData;
  const apis = payload?.apis || {};
  const stats: Record<string, { success: number; failure: number }> = {};

  Object.values(apis).forEach((apiEntry) => {
    const models = apiEntry?.models || {};
    Object.values(models).forEach((modelEntry) => {
      const details = Array.isArray(modelEntry?.details) ? modelEntry.details : [];
      details.forEach((detail) => {
        const authIndexKey = normalizeAuthIndex(detail?.auth_index);
        if (!authIndexKey) return;

        if (!stats[authIndexKey]) {
          stats[authIndexKey] = { success: 0, failure: 0 };
        }

        if (detail?.failed === true) {
          stats[authIndexKey].failure += 1;
        } else {
          stats[authIndexKey].success += 1;
        }
      });
    });
  });

  return stats;
};

export async function GET() {
  if (!API_BASE_URL || !API_MANAGEMENT_KEY) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  try {
    const response = await fetch(`${API_BASE_URL}/usage`, {
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `Backend error: ${response.status} ${text}` }, { status: response.status });
    }

    const data = (await response.json()) as UsagePayload;
    const stats = computeAuthIndexStats(data);

    return NextResponse.json(
      { byAuthIndex: stats },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
