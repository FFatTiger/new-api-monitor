"use client";

import { useCallback, useEffect, useState } from "react";

import type { AuthFile } from "@/types/auth";
import type { QuotaState } from "@/types/quota";

import { apiFetch } from "@/lib/quota/api-client";
import { clearQuotaCache, CACHE_KEY, loadQuotaCache, saveQuotaCache } from "@/lib/quota/cache";
import { fetchQuotaForFile, getProviderType } from "@/lib/quota/providers";

type UsageStatsResponse = {
  byAuthIndex?: Record<string, { success: number; failure: number }>;
};

type CacheSnapshot = {
  authFiles: AuthFile[];
  quotas: Record<string, QuotaState>;
};

const emptyCacheSnapshot: CacheSnapshot = {
  authFiles: [],
  quotas: {},
};

const fetchUsageStats = async () => {
  try {
    const response = await apiFetch("/usage");
    const payload = (await response.json()) as UsageStatsResponse;
    return payload.byAuthIndex || {};
  } catch {
    return {} as Record<string, { success: number; failure: number }>;
  }
};

export const useQuota = () => {
  const cached = typeof window === "undefined" ? null : loadQuotaCache();
  const initialCache = cached && cached.authFiles.length > 0 ? cached : emptyCacheSnapshot;

  const [authFiles, setAuthFiles] = useState<AuthFile[]>(initialCache.authFiles);
  const [quotas, setQuotas] = useState<Record<string, QuotaState>>(initialCache.quotas);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [cacheLoaded, setCacheLoaded] = useState(initialCache !== emptyCacheSnapshot);

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

      const usageStatsPromise = fetchUsageStats();
      const initialQuotas: Record<string, QuotaState> = {};
      files.forEach((file) => {
        initialQuotas[file.authIndex] = { loading: true };
      });
      setQuotas(initialQuotas);

      const results = await Promise.all(
        files.map(async (file) => {
          const provider = getProviderType(file);
          if (provider === "gemini-cli" && file.runtimeOnly) {
            return {
              key: file.authIndex,
              state: { loading: false, error: "Runtime-only (Skipped)", lastUpdated: Date.now() } as QuotaState,
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
        }),
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
    if (cacheLoaded || globalError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadAuthFiles(false);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cacheLoaded, globalError, loadAuthFiles]);

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
    setAutoRefresh,
    loadAuthFiles,
  };
};
