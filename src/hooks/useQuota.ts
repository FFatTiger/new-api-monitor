"use client";

import { useCallback, useEffect, useState } from "react";

import type { AuthFile } from "@/types/auth";
import type { QuotaState, QuotaUsagePredictionRow } from "@/types/quota";

import { apiFetch } from "@/lib/quota/api-client";
import { CACHE_KEY, loadQuotaCache, saveQuotaCache } from "@/lib/quota/cache";
import { DEFAULT_QUOTA_USAGE_WINDOW_MINUTES } from "@/lib/quota/usage-config";

type PredictionResponse = {
  predictions?: QuotaUsagePredictionRow[];
  error?: string;
};

type QuotaLatestResponse = {
  files?: AuthFile[];
  quotas?: Record<string, QuotaState>;
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

  const loadQuotaPredictions = useCallback(async (windowMinutes = DEFAULT_QUOTA_USAGE_WINDOW_MINUTES) => {
    setPredictionLoading(true);
    setPredictionError(null);

    try {
      const response = await apiFetch(`/quota-usage-prediction?windowMinutes=${encodeURIComponent(String(windowMinutes))}`);
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

  const loadAuthFiles = useCallback(async () => {
    setGlobalLoading(true);
    setGlobalError(null);

    try {
      const response = await apiFetch("/quota-latest");
      const payload = (await response.json()) as QuotaLatestResponse;
      const files = payload.files || [];
      const nextQuotas = payload.quotas || {};

      setAuthFiles(files);
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (autoRefresh) {
      timeoutId = setTimeout(() => {
        void loadAuthFiles();
      }, 0);
      interval = setInterval(() => {
        void loadAuthFiles();
      }, 60_000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [autoRefresh, loadAuthFiles]);

  useEffect(() => {
    if (cacheLoaded || globalError || autoRefresh) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadAuthFiles();
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
          void loadAuthFiles();
        }
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === CACHE_KEY && event.newValue === null) {
        void loadAuthFiles();
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
