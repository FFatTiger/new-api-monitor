"use client";

import { useCallback, useEffect, useState } from "react";

import type { AuthFile } from "@/types/auth";
import type { ProviderType, QuotaData, QuotaState, QuotaUsagePredictionRow } from "@/types/quota";

import { apiFetch } from "@/lib/quota/api-client";
import { clearQuotaCache, CACHE_KEY, loadQuotaCache, saveQuotaCache } from "@/lib/quota/cache";
import { getQuotaFetchSkipReason } from "@/lib/quota/fetch-policy";
import { fetchQuotaForFile, getProviderType } from "@/lib/quota/providers";

type UsageStatsResponse = {
  byAuthIndex?: Record<string, { success: number; failure: number }>;
};

type PredictionResponse = {
  predictions?: QuotaUsagePredictionRow[];
  error?: string;
};

type CacheSnapshot = {
  authFiles: AuthFile[];
  quotas: Record<string, QuotaState>;
};

const emptyCacheSnapshot: CacheSnapshot = {
  authFiles: [],
  quotas: {},
};

const MAX_CONCURRENT_QUOTA_REQUESTS = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
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

const fetchUsageStats = async () => {
  try {
    const response = await apiFetch("/usage");
    const payload = (await response.json()) as UsageStatsResponse;
    return payload.byAuthIndex || {};
  } catch {
    return {} as Record<string, { success: number; failure: number }>;
  }
};

function buildSnapshotPayload(files: AuthFile[], quotas: Record<string, QuotaState>) {
  const grouped = new Map<ProviderType, QuotaData[]>();

  files.forEach((file) => {
    const provider = getProviderType(file);
    const data = quotas[file.authIndex]?.data;
    if (!data || provider === "unknown") return;
    grouped.set(provider, [...(grouped.get(provider) || []), data]);
  });

  return {
    providers: Array.from(grouped.entries()).map(([provider, data]) => ({ provider, data })),
  };
}

async function recordQuotaSnapshots(files: AuthFile[], quotas: Record<string, QuotaState>) {
  const payload = buildSnapshotPayload(files, quotas);
  if (!payload.providers.length) return;

  try {
    await apiFetch("/quota-usage-snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("Failed to record quota snapshots", error);
  }
}

export const useQuota = () => {
  const cached = typeof window === "undefined" ? null : loadQuotaCache();
  const initialCache = cached && cached.authFiles.length > 0 ? cached : emptyCacheSnapshot;

  const [authFiles, setAuthFiles] = useState<AuthFile[]>(initialCache.authFiles);
  const [quotas, setQuotas] = useState<Record<string, QuotaState>>(initialCache.quotas);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cacheLoaded, setCacheLoaded] = useState(initialCache !== emptyCacheSnapshot);
  const [quotaPredictions, setQuotaPredictions] = useState<QuotaUsagePredictionRow[]>([]);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);

  const loadQuotaPredictions = useCallback(async () => {
    setPredictionLoading(true);
    setPredictionError(null);

    try {
      const response = await apiFetch("/quota-usage-prediction");
      const payload = (await response.json()) as PredictionResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to fetch quota usage predictions");
      }
      setQuotaPredictions(payload.predictions || []);
    } catch (error: unknown) {
      setPredictionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPredictionLoading(false);
    }
  }, []);

  const loadAuthFiles = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      clearQuotaCache();
    }

    setGlobalLoading(true);
    setGlobalError(null);

    try {
      const response = await apiFetch("/auth-files");
      const data = (await response.json()) as { files?: AuthFile[] };
      const files = data.files || [];
      setAuthFiles(files);

      if (!forceRefresh) {
        setQuotas((previous) => {
          const nextQuotas: Record<string, QuotaState> = {};
          files.forEach((file) => {
            nextQuotas[file.authIndex] = previous[file.authIndex] || { loading: false };
          });
          return nextQuotas;
        });
        setCacheLoaded(true);
        return;
      }

      const usageStatsPromise = fetchUsageStats();
      const initialQuotas: Record<string, QuotaState> = {};
      files.forEach((file) => {
        initialQuotas[file.authIndex] = { loading: true };
      });
      setQuotas(initialQuotas);

      const results = await mapWithConcurrency(
        files,
        MAX_CONCURRENT_QUOTA_REQUESTS,
        async (file) => {
          const skipReason = getQuotaFetchSkipReason(file);
          if (skipReason) {
            return {
              key: file.authIndex,
              state: { loading: false, error: skipReason, lastUpdated: Date.now() } as QuotaState,
            };
          }

          try {
            const resultData = await fetchQuotaForFile(file);
            return {
              key: file.authIndex,
              state: { loading: false, data: resultData, lastUpdated: Date.now() } as QuotaState,
            };
          } catch (error: unknown) {
            return {
              key: file.authIndex,
              state: {
                loading: false,
                error: error instanceof Error ? error.message : String(error),
                lastUpdated: Date.now(),
              } as QuotaState,
            };
          }
        },
      );

      const usageStats = await usageStatsPromise;
      const nextQuotas: Record<string, QuotaState> = {};
      results.forEach((result) => {
        const stats = usageStats[result.key] || { success: 0, failure: 0 };
        nextQuotas[result.key] = {
          ...result.state,
          successCount: stats.success,
          failureCount: stats.failure,
        };
      });

      await recordQuotaSnapshots(files, nextQuotas);
      setQuotas(nextQuotas);
      saveQuotaCache(files, nextQuotas);
      setCacheLoaded(true);
    } catch (error: unknown) {
      setGlobalError(error instanceof Error ? error.message : String(error));
      setCacheLoaded(true);
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (autoRefresh) {
      void loadAuthFiles(true);
      interval = setInterval(() => {
        void loadAuthFiles(true);
      }, 60_000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [autoRefresh, loadAuthFiles]);

  useEffect(() => {
    if (cacheLoaded || globalError || autoRefresh) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadAuthFiles(false);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoRefresh, cacheLoaded, globalError, loadAuthFiles]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const nextCached = loadQuotaCache();
        if (!nextCached && authFiles.length > 0) {
          void loadAuthFiles(true);
        }
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === CACHE_KEY && event.newValue === null) {
        void loadAuthFiles(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [authFiles.length, loadAuthFiles]);

  return {
    authFiles,
    quotas,
    globalLoading,
    globalError,
    autoRefresh,
    quotaPredictions,
    predictionLoading,
    predictionError,
    setAutoRefresh,
    loadAuthFiles,
    loadQuotaPredictions,
  };
};
