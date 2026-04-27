"use client";

import { useRef, useState } from "react";

import type { AuthFile } from "@/types/auth";
import type { ProviderFilter, ProviderType, QuotaState } from "@/types/quota";

import { QuotaContent } from "@/components/quota/quota-content";
import { ProviderIcon } from "@/components/quota/provider-icon";
import { QuotaIcons } from "@/components/quota/quota-icons";

function getCodexPlanBadge(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;

  const planType = String(data.plan_type || data.planType || "").toLowerCase();
  if (planType.includes("enterprise")) return "Enterprise";
  if (planType.includes("team")) return "Team";
  if (planType.includes("pro")) return "Pro";
  if (planType.includes("plus")) return "Plus";
  if (planType.includes("free") || !planType) return "Free";
  return planType;
}

type ProviderCardProps = {
  file: AuthFile;
  provider: ProviderType;
  quota: QuotaState;
  selectedProvider: ProviderFilter;
};

export function ProviderCard({ file, provider, quota, selectedProvider }: ProviderCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    hoverTimer.current = setTimeout(() => {
      setShowTooltip(true);
    }, 500);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setShowTooltip(false);
  };

  const showProviderBadge = selectedProvider === "all";
  const codexPlan = getCodexPlanBadge(quota.data as Record<string, unknown> | undefined);
  const isLimitReached = quota.data?.rate_limit?.limit_reached || quota.data?.rateLimit?.limit_reached;

  return (
    <article className="ds-card-muted ds-card-interactive flex h-full flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <div className="rounded-[12px] bg-[var(--background-elevated)] p-2 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
            <ProviderIcon type={provider} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-[0.92rem] font-semibold text-[var(--foreground)]" title={file.displayName}>
              {file.displayName}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem]">
              {showProviderBadge ? <span className="ds-kicker">{provider === "unknown" ? file.type || "未知" : provider}</span> : null}
              {provider === "codex" && codexPlan ? <span className="ds-pill px-2 py-1 text-[0.66rem]">{codexPlan}</span> : null}
              {provider === "codex" && isLimitReached ? <span className="ds-pill px-2 py-1 text-[0.66rem] text-red-500">已达上限</span> : null}
              {file.runtimeOnly ? <span className="ds-pill px-2 py-1 text-[0.66rem] text-amber-500">RT</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-0.5 shrink-0">
          {quota.loading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--surface-ring-soft)] border-t-[var(--foreground)]" /> : null}
          {!quota.loading && quota.error ? <QuotaIcons.Alert className="h-4 w-4 text-red-500" /> : null}
          {!quota.loading && !quota.error ? <QuotaIcons.Check className="h-4 w-4 text-emerald-500" /> : null}
        </div>
      </div>

      <div className="min-h-[72px] flex-1">
        {quota.loading ? (
          <div className="space-y-2.5 animate-pulse">
            <div className="h-2 rounded-full bg-[var(--background-subtle)]" />
            <div className="h-2 w-2/3 rounded-full bg-[var(--background-subtle)]" />
          </div>
        ) : quota.error ? (
          <p className="text-[0.78rem] leading-5 text-red-500">{quota.error}</p>
        ) : (
          <QuotaContent type={provider} data={quota.data || {}} />
        )}
      </div>

      <div className="ds-divider mt-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="ds-mono text-[0.66rem] text-[var(--foreground-faint)]" title={file.authIndex}>
            #{file.authIndex?.slice(-6) || "-"}
          </span>
          <div className="relative flex items-center gap-3" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <div className="flex items-center gap-1 text-[0.68rem] text-[var(--foreground-soft)]">
              <QuotaIcons.Check className="h-3.5 w-3.5 text-emerald-500" />
              <span className="ds-mono">{quota.successCount || 0}</span>
            </div>
            <div className="flex items-center gap-1 text-[0.68rem] text-[var(--foreground-soft)]">
              <QuotaIcons.X className="h-3.5 w-3.5 text-red-500" />
              <span className="ds-mono">{quota.failureCount || 0}</span>
            </div>
            <div
              className={[
                "ds-overlay-card absolute right-0 top-full z-30 mt-2 w-64 rounded-[16px] p-3 text-[0.72rem] transition-all duration-150",
                showTooltip ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0 pointer-events-none",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--foreground-soft)]">Results</span>
                <div className="flex items-center gap-3">
                  <span className="ds-mono text-emerald-500">{quota.successCount || 0}</span>
                  <span className="ds-mono text-red-500">{quota.failureCount || 0}</span>
                </div>
              </div>
              {file.statusMessage ? (
                <pre className="mt-2 whitespace-pre-wrap break-all rounded-[12px] bg-[var(--background-subtle)] p-2 text-[0.67rem] leading-5 text-[var(--foreground-soft)] shadow-[0_0_0_1px_var(--surface-ring-soft)]">
                  {file.statusMessage}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
