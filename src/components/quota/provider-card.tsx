"use client";

import { useRef, useState } from "react";

import type { AuthFile } from "@/types/auth";
import type { ProviderFilter, ProviderType, QuotaState } from "@/types/quota";

import { QuotaContent } from "@/components/quota/quota-content";
import { ProviderIcon } from "@/components/quota/provider-icon";
import { QuotaIcons } from "@/components/quota/quota-icons";
import { getWeeklyQuotaRingData, type WeeklyQuotaRingData } from "@/lib/quota/card-ring";
import { getCodexPlanLabel } from "@/lib/quota/upstream";

function getCodexPlanBadge(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;

  return getCodexPlanLabel(data.plan_type || data.planType);
}

function getClaudePlanBadge(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;

  const planType = String(data.planType || data.plan_type || "").toLowerCase();
  if (planType === "max") return "Max";
  if (planType === "team") return "Team";
  if (planType === "pro") return "Pro";
  if (planType === "free") return "Free";
  return planType || null;
}

function getSimplePlanBadge(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;

  const tierLabel = data.tierLabel || data.tier_label;
  if (typeof tierLabel === "string" && tierLabel.trim()) return tierLabel.trim();

  const planType = String(data.planType || data.plan_type || "").trim();
  if (!planType) return null;
  return `${planType.slice(0, 1).toUpperCase()}${planType.slice(1)}`;
}

type ProviderCardProps = {
  file: AuthFile;
  provider: ProviderType;
  quota: QuotaState;
  selectedProvider: ProviderFilter;
};

const ringToneClass: Record<WeeklyQuotaRingData["tone"], string> = {
  emerald: "text-emerald-500",
  amber: "text-amber-500",
  red: "text-red-500",
  muted: "text-[var(--foreground-faint)]",
};

function WeeklyQuotaRing({ ring }: { ring: WeeklyQuotaRingData }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const progress = ring.percent ?? 0;
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <div className={`relative grid h-8 w-8 place-items-center ${ringToneClass[ring.tone]}`} aria-label={`${ring.label} ${ring.valueLabel}`} title={`${ring.label} ${ring.valueLabel}`}>
      <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r={radius} fill="none" stroke="var(--surface-ring-soft)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="ds-mono absolute text-[0.52rem] font-semibold leading-none text-[var(--foreground)]">{ring.valueLabel}</span>
    </div>
  );
}

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
  const claudePlan = getClaudePlanBadge(quota.data as Record<string, unknown> | undefined);
  const simplePlan = getSimplePlanBadge(quota.data as Record<string, unknown> | undefined);
  const isPremiumCodexPlan = provider === "codex" && (codexPlan === "Pro 5x" || codexPlan === "Pro 20x");
  const isLimitReached = quota.data?.rate_limit?.limit_reached || quota.data?.rateLimit?.limit_reached;
  const weeklyQuotaRing = getWeeklyQuotaRingData(provider, quota.data);

  return (
    <article className={["ds-card-muted ds-card-interactive flex h-full flex-col p-4", isPremiumCodexPlan ? "ds-card-premium-tier" : ""].filter(Boolean).join(" ")}>
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
              {provider === "claude" && claudePlan ? <span className="ds-pill px-2 py-1 text-[0.66rem]">{claudePlan}</span> : null}
              {(provider === "minimax" || provider === "xai" || provider === "zai") && simplePlan ? <span className="ds-pill px-2 py-1 text-[0.66rem]">{simplePlan}</span> : null}
              {provider === "codex" && codexPlan ? (
                <span className={["ds-pill px-2 py-1 text-[0.66rem]", isPremiumCodexPlan ? "ds-pill-premium-tier" : ""].filter(Boolean).join(" ")}>{codexPlan}</span>
              ) : null}
              {provider === "codex" && isLimitReached ? <span className="ds-pill px-2 py-1 text-[0.66rem] text-red-500">已达上限</span> : null}
              {file.runtimeOnly ? <span className="ds-pill px-2 py-1 text-[0.66rem] text-amber-500">RT</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-0.5 shrink-0">
          {quota.loading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--surface-ring-soft)] border-t-[var(--foreground)]" /> : null}
          {!quota.loading && quota.error ? <QuotaIcons.Alert className="h-4 w-4 text-red-500" /> : null}
          {!quota.loading && !quota.error && quota.data ? <WeeklyQuotaRing ring={weeklyQuotaRing} /> : null}
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
        ) : !quota.data ? (
          <p className="text-[0.78rem] leading-5 text-[var(--foreground-faint)]">点击刷新获取配额</p>
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
