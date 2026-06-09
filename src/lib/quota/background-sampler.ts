import type { AuthFile } from "../../types/auth.ts";
import type { ProviderType } from "../../types/quota.ts";

import { upsertQuotaLatestRows, type QuotaLatestInput, type QuotaLatestRow } from "../queries/quota-latest.ts";
import { recordQuotaSnapshots } from "../queries/quota-usage-prediction.ts";
import { getQuotaFetchSkipReason } from "./fetch-policy.ts";
import { getQuotaSnapshotIntervalSecondsFromEnv } from "./usage-config.ts";
import { aggregateProviderQuotaSnapshot } from "./usage-aggregation.ts";
import { fetchQuotaForAuthFileOnServer } from "./server-fetch.ts";
import { fetchBackendAuthFileContent, listServerAuthFiles } from "./server-auth-files.ts";
import { fetchBackendUsageStats, type AuthIndexUsageStats } from "./usage-stats.ts";
import { resolveProviderType } from "./upstream.ts";

const MAX_CONCURRENT_QUOTA_REQUESTS = 3;

type SamplerState = {
  started: boolean;
  running: boolean;
  interval?: ReturnType<typeof setInterval>;
};

type SamplerOptions = {
  intervalMs?: number;
  runImmediately?: boolean;
  logger?: Pick<Console, "error" | "log" | "warn">;
};

declare global {
  var __newApiMonitorQuotaSamplerState: SamplerState | undefined;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function buildProviderQuotaSnapshotsFromLatestRows(files: AuthFile[], rows: QuotaLatestRow[]) {
  const rowsByAuthIndex = new Map(rows.map((row) => [row.authIndex, row] as const));
  const grouped = new Map<ProviderType, NonNullable<QuotaLatestRow["quotaData"]>[]>();

  files.forEach((file) => {
    const provider = resolveProviderType(file) as ProviderType;
    const row = rowsByAuthIndex.get(file.authIndex);
    if (provider === "unknown" || !row?.quotaData || row.error) return;
    grouped.set(provider, [...(grouped.get(provider) || []), row.quotaData]);
  });

  return Array.from(grouped.entries())
    .map(([provider, dataItems]) => aggregateProviderQuotaSnapshot(provider, dataItems))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));
}

export async function sampleQuotaUsageOnce(nowSeconds = Math.floor(Date.now() / 1000), fetchImpl: typeof fetch = fetch) {
  const { files, rawFiles, config } = await listServerAuthFiles(fetchImpl);
  const usageStats: AuthIndexUsageStats = await fetchBackendUsageStats(config, fetchImpl).catch(() => ({}));
  const context = {
    config,
    rawFiles,
    fetchImpl,
    fetchFileContent: (name: string) => fetchBackendAuthFileContent(name, config, fetchImpl),
  };

  const rows = await mapWithConcurrency(files, MAX_CONCURRENT_QUOTA_REQUESTS, async (file): Promise<QuotaLatestInput> => {
    const provider = resolveProviderType(file) as ProviderType;
    const stats = usageStats[file.authIndex] || { success: 0, failure: 0 };
    const base = {
      authIndex: file.authIndex,
      provider,
      sampledAt: nowSeconds,
      successCount: stats.success,
      failureCount: stats.failure,
    };

    const skipReason = getQuotaFetchSkipReason(file);
    if (skipReason) {
      return { ...base, quotaData: null, error: skipReason };
    }

    try {
      const quotaData = await fetchQuotaForAuthFileOnServer(file, context);
      return { ...base, quotaData, error: null };
    } catch (error: unknown) {
      return { ...base, quotaData: null, error: errorMessage(error) };
    }
  });

  await upsertQuotaLatestRows(rows);
  const snapshots = buildProviderQuotaSnapshotsFromLatestRows(files, rows);
  const snapshotResult = await recordQuotaSnapshots(snapshots, nowSeconds);

  return {
    files: files.length,
    upserted: rows.length,
    snapshots: snapshots.length,
    insertedSnapshots: snapshotResult.inserted,
  };
}

export function startQuotaBackgroundSampler(options: SamplerOptions = {}) {
  const state = (globalThis.__newApiMonitorQuotaSamplerState ||= { started: false, running: false });
  if (state.started) return state;

  const logger = options.logger || console;
  const intervalMs = options.intervalMs || getQuotaSnapshotIntervalSecondsFromEnv() * 1000;
  const runImmediately = options.runImmediately ?? true;

  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await sampleQuotaUsageOnce();
    } catch (error: unknown) {
      logger.error("Quota background sampler failed", error);
    } finally {
      state.running = false;
    }
  };

  state.started = true;
  if (runImmediately) {
    setTimeout(() => {
      void run();
    }, 0);
  }
  state.interval = setInterval(() => {
    void run();
  }, intervalMs);

  logger.log(`Quota background sampler started with ${intervalMs}ms interval`);
  return state;
}
