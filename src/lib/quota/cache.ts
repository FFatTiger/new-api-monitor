import type { AuthFile } from "@/types/auth";
import type { CacheData, QuotaState } from "@/types/quota";

export const CACHE_KEY = "quota_cache_v2";
const LEGACY_CACHE_KEYS = ["quota_cache"];
const CACHE_TTL = 5 * 60 * 1000;

export const loadQuotaCache = (): CacheData | null => {
  try {
    LEGACY_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheData;
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const saveQuotaCache = (authFiles: AuthFile[], quotas: Record<string, QuotaState>) => {
  try {
    LEGACY_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    const data: CacheData = { authFiles, quotas, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {}
};

export const clearQuotaCache = () => {
  try {
    LEGACY_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(CACHE_KEY);
  } catch {}
};
