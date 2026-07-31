"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import type {
  SubscriptionBillingFilters,
  SubscriptionBillingPreset,
} from "@/lib/queries/subscription-billing-filters";

interface SubscriptionBillingHeaderControlsProps {
  filters: SubscriptionBillingFilters;
}

const visiblePresets: Array<{ value: SubscriptionBillingPreset; label: string }> = [
  { value: "this_month", label: "本月" },
  { value: "last_month", label: "上月" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "不限" },
  { value: "custom", label: "自定义" },
];

const fieldClass =
  "ds-input h-10 px-3 text-[0.82rem] text-[var(--foreground)] placeholder:text-[var(--foreground-faint)]";
const labelClass = "space-y-1.5 text-[0.69rem] font-medium text-[var(--foreground-soft)]";

export function SubscriptionBillingHeaderControls({
  filters,
}: SubscriptionBillingHeaderControlsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPreset, setDialogPreset] = useState<SubscriptionBillingPreset>(filters.preset);
  const [quickPreset, setQuickPreset] = useState<SubscriptionBillingPreset>(filters.preset);
  const [customStartInput, setCustomStartInput] = useState(filters.startInput);
  const [customEndInput, setCustomEndInput] = useState(filters.endInput);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogPreset(filters.preset);
    setQuickPreset(filters.preset);
    setCustomStartInput(filters.startInput);
    setCustomEndInput(filters.endInput);
  }, [filters.endInput, filters.preset, filters.startInput]);

  useEffect(() => {
    // Route/search-param changes must replace draft values (including Link navigation and back/forward).
    // A synchronous state reset is intentional because these are controlled form drafts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuickPreset(filters.preset);
    setDialogPreset(filters.preset);
    setCustomStartInput(filters.startInput);
    setCustomEndInput(filters.endInput);
  }, [filters.endInput, filters.preset, filters.startInput]);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDialog, dialogOpen]);

  function handleQuickPresetChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextPreset = event.target.value as SubscriptionBillingPreset;

    if (nextPreset === "custom") {
      setDialogPreset("custom");
      setDialogOpen(true);
      return;
    }

    setQuickPreset(nextPreset);
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <form method="get" className="flex items-center gap-2">
          <label className="sr-only" htmlFor="subscription-billing-quick-preset">
            订阅消费时间范围
          </label>
          <select
            id="subscription-billing-quick-preset"
            name="preset"
            value={quickPreset}
            onChange={handleQuickPresetChange}
            className="ds-compact-control h-10 min-w-[112px] appearance-none pr-8"
          >
            {visiblePresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </form>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="ds-icon-button h-10 w-10"
          aria-label="打开订阅消费时间筛选"
        >
          <FilterIcon />
        </button>
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5">
          <button
            type="button"
            aria-label="关闭订阅消费时间筛选"
            className="ds-overlay-panel absolute inset-0"
            onClick={closeDialog}
          />
          <div className="ds-overlay-card relative z-10 w-full rounded-t-[24px] px-4 py-4 sm:max-w-[560px] sm:rounded-[24px] sm:px-6 sm:py-5">
            <div className="ds-divider mb-5 flex items-start justify-between gap-4 pb-4">
              <div>
                <p className="ds-kicker">筛选</p>
                <h2 className="mt-3 text-[1.15rem] font-semibold tracking-[-0.06em] text-[var(--foreground)] sm:text-[1.35rem]">
                  订阅消费时间范围
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="ds-icon-button h-9 w-9 text-[1rem]"
                aria-label="关闭订阅消费时间筛选"
              >
                ×
              </button>
            </div>

            <form method="get" className="grid gap-3 sm:grid-cols-2">
              <label className={`${labelClass} sm:col-span-2`}>
                <span>时间范围</span>
                <select
                  name="preset"
                  value={dialogPreset}
                  onChange={(event) => setDialogPreset(event.target.value as SubscriptionBillingPreset)}
                  className={`${fieldClass} appearance-none`}
                >
                  {visiblePresets.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              {dialogPreset === "custom" ? (
                <>
                  <label className={labelClass}>
                    <span>开始时间（北京时间）</span>
                    <input
                      name="start"
                      type="datetime-local"
                      value={customStartInput}
                      onChange={(event) => setCustomStartInput(event.target.value)}
                      className={fieldClass}
                      required
                    />
                  </label>

                  <label className={labelClass}>
                    <span>结束时间（北京时间）</span>
                    <input
                      name="end"
                      type="datetime-local"
                      value={customEndInput}
                      onChange={(event) => setCustomEndInput(event.target.value)}
                      className={fieldClass}
                      required
                    />
                  </label>
                </>
              ) : null}

              <div className="flex flex-col gap-2 pt-1 sm:col-span-2 sm:flex-row sm:justify-end">
                <button
                  type="submit"
                  className="ds-button-primary h-10 px-4 text-[0.8rem] font-medium sm:min-w-[96px]"
                >
                  应用
                </button>
                <Link
                  href="/subscriptions"
                  className="ds-button-secondary h-10 px-4 text-[0.8rem] font-medium sm:min-w-[96px]"
                >
                  清空
                </Link>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M2.25 3.25h11.5M4.75 8h6.5M6.75 12.75h2.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}
