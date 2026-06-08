"use client";

import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/navigation/app-header";
import { ProviderCard } from "@/components/quota/provider-card";
import { QuotaPredictionPanel } from "@/components/quota/quota-prediction-panel";
import { QuotaIcons } from "@/components/quota/quota-icons";
import { ProviderTabs } from "@/components/quota/provider-tabs";
import { useQuota } from "@/hooks/useQuota";
import { normalizeFraction } from "@/lib/quota/normalize";
import { getProviderType } from "@/lib/quota/providers";
import { sortQuotaFiles } from "@/lib/quota/sort-policy";
import { DEFAULT_QUOTA_USAGE_WINDOW_MINUTES } from "@/lib/quota/usage-config";
import type { ProviderFilter, QuotaState } from "@/types/quota";

const providerTabs: Array<{ key: ProviderFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "antigravity", label: "Antigravity" },
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
  { key: "gemini-cli", label: "Gemini CLI" },
  { key: "kimi", label: "Kimi" },
  { key: "minimax", label: "MiniMax" },
  { key: "xai", label: "Grok" },
  { key: "zai", label: "Z.ai" },
];

type SortOption =
  | "default"
  | "ag_claude_quota"
  | "ag_claude_refresh"
  | "ag_gemini_quota"
  | "ag_gemini_refresh"
  | "codex_5h_quota"
  | "codex_5h_refresh"
  | "codex_week_quota"
  | "codex_week_refresh";

const antigravitySortOptions: Array<{ key: SortOption; label: string }> = [
  { key: "default", label: "默认排序" },
  { key: "ag_claude_quota", label: "Claude 总额度" },
  { key: "ag_claude_refresh", label: "Claude 刷新时间" },
  { key: "ag_gemini_quota", label: "Gemini 总额度" },
  { key: "ag_gemini_refresh", label: "Gemini 刷新时间" },
];

const codexSortOptions: Array<{ key: SortOption; label: string }> = [
  { key: "default", label: "默认排序" },
  { key: "codex_5h_quota", label: "5小时额度" },
  { key: "codex_5h_refresh", label: "5小时刷新时间" },
  { key: "codex_week_quota", label: "周额度" },
  { key: "codex_week_refresh", label: "周刷新时间" },
];

const antigravityModelGroups = {
  claude: { patterns: ["claude", "gpt-oss"] },
  gemini: { patterns: ["gemini-3", "gemini-2.5"] },
} as const;

type AntigravityGroup = keyof typeof antigravityModelGroups;

function parseResetTime(value?: string | number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value * 1000;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const parsed = new Date(trimmed).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function getAntigravityMetrics(quota: QuotaState | undefined, group: AntigravityGroup) {
  const models = quota?.data?.models;
  if (!models) return null;

  const patterns = antigravityModelGroups[group].patterns;
  let minFraction = Infinity;
  let selectedResetTime: number | undefined;
  let hasMatch = false;

  for (const [modelId, model] of Object.entries(models)) {
    if (!patterns.some((pattern) => modelId.toLowerCase().includes(pattern))) {
      continue;
    }

    const info = model.quotaInfo || model.quota_info;
    if (!info) continue;

    const remaining = info.remaining_fraction ?? info.remainingFraction ?? info.remaining;
    if (remaining === undefined || remaining === null) continue;

    const fraction = normalizeFraction(remaining);
    if (Number.isNaN(fraction)) continue;

    hasMatch = true;
    if (fraction < minFraction) {
      minFraction = fraction;
      selectedResetTime = parseResetTime(info.resetTime ?? info.reset_time);
    }
  }

  if (!hasMatch) return null;
  return { fraction: minFraction, resetTime: selectedResetTime };
}

function getCodexMetrics(quota: QuotaState | undefined, window: "primary" | "secondary") {
  const windows = quota?.data?.windows;
  if (Array.isArray(windows)) {
    const match = windows.find((item) =>
      window === "primary" ? item.id === "codex-five-hour" : item.id === "codex-weekly",
    );
    if (match) {
      const remaining =
        match.remainingPercent ??
        match.remaining_percent ??
        (match.used_percent === undefined ? undefined : Math.max(0, 100 - match.used_percent));
      const resetTime = parseResetTime(match.resetTime ?? match.reset_time ?? match.reset_at ?? match.resetAt);

      if (remaining !== undefined || resetTime !== undefined) {
        return { remaining: remaining ?? undefined, resetTime };
      }
    }
  }

  const rateLimit = quota?.data?.rate_limit || quota?.data?.rateLimit;
  if (!rateLimit) return null;

  const windowData =
    window === "primary"
      ? rateLimit.primary_window || rateLimit.primaryWindow
      : rateLimit.secondary_window || rateLimit.secondaryWindow;
  if (!windowData) return null;

  const used = windowData.used_percent ?? windowData.usedPercent;
  const remaining = used === undefined || used === null ? undefined : Math.max(0, 100 - used);
  const resetTime = parseResetTime(windowData.reset_at ?? windowData.resetAt);

  if (remaining === undefined && resetTime === undefined) return null;
  return { remaining, resetTime };
}

export function QuotaPageClient() {
  const {
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
  } = useQuota();
  const [selectedProvider, setSelectedProvider] = useState<ProviderFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("default");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [usageWindowMinutes, setUsageWindowMinutes] = useState(DEFAULT_QUOTA_USAGE_WINDOW_MINUTES);

  useEffect(() => {
    void loadQuotaPredictions(usageWindowMinutes);
  }, [loadQuotaPredictions, quotas, usageWindowMinutes]);

  const providerCounts = useMemo(() => {
    const counts: Record<ProviderFilter, number> = {
      all: authFiles.length,
      antigravity: 0,
      claude: 0,
      codex: 0,
      "gemini-cli": 0,
      kimi: 0,
      minimax: 0,
      xai: 0,
      zai: 0,
    };

    authFiles.forEach((file) => {
      const provider = getProviderType(file);
      if (
        provider === "antigravity" ||
        provider === "claude" ||
        provider === "codex" ||
        provider === "gemini-cli" ||
        provider === "kimi" ||
        provider === "minimax" ||
        provider === "xai" ||
        provider === "zai"
      ) {
        counts[provider] += 1;
      }
    });

    return counts;
  }, [authFiles]);

  const sortedFiles = useMemo(() => {
    const filtered = selectedProvider === "all" ? authFiles : authFiles.filter((file) => getProviderType(file) === selectedProvider);

    if (
      selectedProvider === "all" ||
      selectedProvider === "claude" ||
      selectedProvider === "gemini-cli" ||
      selectedProvider === "kimi" ||
      selectedProvider === "minimax" ||
      selectedProvider === "xai" ||
      selectedProvider === "zai" ||
      sortOption === "default"
    ) {
      return sortQuotaFiles(filtered, quotas, selectedProvider);
    }

    return [...filtered].sort((a, b) => {
      const quotaA = quotas[a.authIndex];
      const quotaB = quotas[b.authIndex];

      const compareWithMissing = (valueA: number | null | undefined, valueB: number | null | undefined, asc: boolean) => {
        if ((valueA === null || valueA === undefined) && (valueB === null || valueB === undefined)) return 0;
        if (valueA === null || valueA === undefined) return 1;
        if (valueB === null || valueB === undefined) return -1;
        return asc ? valueA - valueB : valueB - valueA;
      };

      const isAsc = sortDirection === "asc";
      let result = 0;

      if (selectedProvider === "antigravity") {
        const metricsAClaude = getAntigravityMetrics(quotaA, "claude");
        const metricsBClaude = getAntigravityMetrics(quotaB, "claude");
        const metricsAGemini = getAntigravityMetrics(quotaA, "gemini");
        const metricsBGemini = getAntigravityMetrics(quotaB, "gemini");

        switch (sortOption) {
          case "ag_claude_quota":
            result = compareWithMissing(metricsAClaude?.fraction, metricsBClaude?.fraction, isAsc);
            break;
          case "ag_claude_refresh":
            result = compareWithMissing(metricsAClaude?.resetTime, metricsBClaude?.resetTime, isAsc);
            break;
          case "ag_gemini_quota":
            result = compareWithMissing(metricsAGemini?.fraction, metricsBGemini?.fraction, isAsc);
            break;
          case "ag_gemini_refresh":
            result = compareWithMissing(metricsAGemini?.resetTime, metricsBGemini?.resetTime, isAsc);
            break;
        }
      }

      if (selectedProvider === "codex") {
        const metricsAPrimary = getCodexMetrics(quotaA, "primary");
        const metricsBPrimary = getCodexMetrics(quotaB, "primary");
        const metricsASecondary = getCodexMetrics(quotaA, "secondary");
        const metricsBSecondary = getCodexMetrics(quotaB, "secondary");

        switch (sortOption) {
          case "codex_5h_quota":
            result = compareWithMissing(metricsAPrimary?.remaining, metricsBPrimary?.remaining, isAsc);
            break;
          case "codex_5h_refresh":
            result = compareWithMissing(metricsAPrimary?.resetTime, metricsBPrimary?.resetTime, isAsc);
            break;
          case "codex_week_quota":
            result = compareWithMissing(metricsASecondary?.remaining, metricsBSecondary?.remaining, isAsc);
            break;
          case "codex_week_refresh":
            result = compareWithMissing(metricsASecondary?.resetTime, metricsBSecondary?.resetTime, isAsc);
            break;
        }
      }

      if (result !== 0) return result;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [authFiles, quotas, selectedProvider, sortDirection, sortOption]);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {selectedProvider === "antigravity" || selectedProvider === "codex" ? (
        <>
          <select
            value={sortOption}
            onChange={(event) => {
              const nextOption = event.target.value as SortOption;
              setSortOption(nextOption);
              setSortDirection(nextOption.includes("refresh") ? "asc" : "desc");
            }}
            className="ds-compact-control h-10 min-w-[132px] appearance-none pr-8"
            aria-label="排序方式"
          >
            {(selectedProvider === "antigravity" ? antigravitySortOptions : codexSortOptions).map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"))}
            disabled={sortOption === "default"}
            className="ds-icon-button h-10 w-10 disabled:opacity-45"
            aria-label={sortDirection === "asc" ? "切换为降序" : "切换为升序"}
          >
            <span className="ds-mono text-[0.8rem]">{sortDirection === "asc" ? "↑" : "↓"}</span>
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setAutoRefresh(!autoRefresh)}
        className={["ds-button-secondary h-10 px-4 text-[0.8rem] font-medium", autoRefresh ? "text-blue-500" : ""].join(" ")}
      >
        自动刷新 {autoRefresh ? "开" : "关"}
      </button>

      <button
        type="button"
        onClick={() => void loadAuthFiles(true)}
        disabled={globalLoading}
        className="ds-icon-button h-10 w-10"
        aria-label="刷新 quota 数据"
      >
        <QuotaIcons.Refresh className={globalLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      </button>
    </div>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AppHeader controls={controls} subtitle="统一查看账号可用配额、刷新时间与运行结果。" />

      <section className="flex flex-col gap-4">
        <ProviderTabs
          tabs={providerTabs}
          selected={selectedProvider}
          counts={providerCounts}
          onSelect={(provider) => {
            setSelectedProvider(provider);
            setSortOption("default");
            setSortDirection("desc");
          }}
        />

        <QuotaPredictionPanel
          predictions={quotaPredictions}
          selectedProvider={selectedProvider}
          windowMinutes={usageWindowMinutes}
          loading={predictionLoading}
          error={predictionError}
          onWindowMinutesChange={setUsageWindowMinutes}
        />

        {globalError ? (
          <div className="ds-card flex items-start gap-3 p-4 text-[0.86rem] text-red-500">
            <QuotaIcons.Alert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span className="font-medium">加载失败：</span>
              {globalError}
            </div>
          </div>
        ) : null}

        {!globalLoading && authFiles.length === 0 && !globalError ? (
          <div className="ds-panel flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <QuotaIcons.Server className="h-10 w-10 text-[var(--foreground-faint)]" />
            <div>
              <p className="text-[0.95rem] font-medium text-[var(--foreground)]">未找到可用账号</p>
              <p className="mt-1 text-[0.82rem] text-[var(--foreground-soft)]">请检查服务端 `API_BASE_URL` 与 `API_MANAGEMENT_KEY` 配置。</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedFiles.map((file) => {
            const provider = getProviderType(file);
            const quota = quotas[file.authIndex] || { loading: false };
            return (
              <ProviderCard
                key={file.authIndex}
                file={file}
                provider={provider}
                quota={quota}
                selectedProvider={selectedProvider}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}
