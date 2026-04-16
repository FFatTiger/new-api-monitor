"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";

import type { DashboardFilters, FilterOption, FilterPreset } from "@/lib/queries/dashboard";

interface DashboardHeaderControlsProps {
  filters: DashboardFilters;
  usernameOptions: FilterOption[];
  modelOptions: FilterOption[];
  channelOptions: FilterOption[];
}

const visiblePresets: Array<{ value: FilterPreset; label: string }> = [
  { value: "today", label: "今天" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "all", label: "不限" },
  { value: "custom", label: "自定义" },
];

const fieldClass =
  "ds-input h-10 px-3 text-[0.82rem] text-[var(--foreground)] placeholder:text-[var(--foreground-faint)]";
const labelClass = "space-y-1.5 text-[0.69rem] font-medium text-[var(--foreground-soft)]";

export function DashboardHeaderControls({
  filters,
  usernameOptions,
  modelOptions,
  channelOptions,
}: DashboardHeaderControlsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPreset, setDialogPreset] = useState<FilterPreset>(filters.preset);
  const [quickPreset, setQuickPreset] = useState<FilterPreset>(filters.preset);
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
    const nextPreset = event.target.value as FilterPreset;

    if (nextPreset === "custom") {
      setDialogPreset("custom");
      setDialogOpen(true);
      return;
    }

    setQuickPreset(nextPreset);
    event.currentTarget.form?.requestSubmit();
  }

  const showCustomDateTime = dialogPreset === "custom";

  return (
    <>
      <div className="flex items-center gap-2">
        <form method="get" className="flex items-center gap-2">
          <label className="sr-only" htmlFor="dashboard-quick-preset">
            时间范围
          </label>
          <select
            id="dashboard-quick-preset"
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

          <PersistedFilterInputs filters={filters} />
        </form>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="ds-icon-button h-10 w-10"
          aria-label="打开高级筛选"
        >
          <FilterIcon />
        </button>
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5">
          <button type="button" aria-label="关闭高级筛选" className="ds-overlay-panel absolute inset-0" onClick={closeDialog} />
          <div className="ds-overlay-card relative z-10 w-full rounded-t-[24px] px-4 py-4 sm:max-w-[760px] sm:rounded-[24px] sm:px-6 sm:py-5">
            <div className="ds-divider mb-5 flex items-start justify-between gap-4 pb-4">
              <div>
                <p className="ds-kicker">筛选</p>
                <h2 className="mt-3 text-[1.15rem] font-semibold tracking-[-0.06em] text-[var(--foreground)] sm:text-[1.35rem]">
                  高级筛选
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="ds-icon-button h-9 w-9 text-[1rem]"
                aria-label="关闭高级筛选"
              >
                ×
              </button>
            </div>

            <form method="get" className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                <span>时间范围</span>
                <select
                  name="preset"
                  value={dialogPreset}
                  onChange={(event) => setDialogPreset(event.target.value as FilterPreset)}
                  className={`${fieldClass} appearance-none`}
                >
                  {visiblePresets.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={labelClass}>
                <span>密钥</span>
                <input
                  name="token"
                  type="text"
                  defaultValue={filters.token}
                  placeholder="搜索密钥名称"
                  className={fieldClass}
                />
              </label>

              <label className={labelClass}>
                <span>用户</span>
                <select name="username" defaultValue={filters.username} className={`${fieldClass} appearance-none`}>
                  <option value="">全部</option>
                  {usernameOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={labelClass}>
                <span>模型</span>
                <select name="model" defaultValue={filters.model} className={`${fieldClass} appearance-none`}>
                  <option value="">全部</option>
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={labelClass}>
                <span>渠道</span>
                <select name="channelId" defaultValue={filters.channelId} className={`${fieldClass} appearance-none`}>
                  <option value="">全部</option>
                  {channelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {showCustomDateTime ? (
                <>
                  <label className={labelClass}>
                    <span>开始时间</span>
                    <input
                      name="start"
                      type="datetime-local"
                      value={customStartInput}
                      onChange={(event) => setCustomStartInput(event.target.value)}
                      className={fieldClass}
                    />
                  </label>

                  <label className={labelClass}>
                    <span>结束时间</span>
                    <input
                      name="end"
                      type="datetime-local"
                      value={customEndInput}
                      onChange={(event) => setCustomEndInput(event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                </>
              ) : (
                <>
                  {customStartInput ? <input type="hidden" name="start" value={customStartInput} /> : null}
                  {customEndInput ? <input type="hidden" name="end" value={customEndInput} /> : null}
                </>
              )}

              <div className="flex flex-col gap-2 pt-1 sm:col-span-2 sm:flex-row sm:justify-end">
                <button type="submit" className="ds-button-primary h-10 px-4 text-[0.8rem] font-medium sm:min-w-[96px]">
                  应用
                </button>
                <Link href="/" className="ds-button-secondary h-10 px-4 text-[0.8rem] font-medium sm:min-w-[96px]">
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

function PersistedFilterInputs({ filters }: { filters: DashboardFilters }) {
  return (
    <>
      {filters.token ? <input type="hidden" name="token" value={filters.token} /> : null}
      {filters.username ? <input type="hidden" name="username" value={filters.username} /> : null}
      {filters.model ? <input type="hidden" name="model" value={filters.model} /> : null}
      {filters.channelId ? <input type="hidden" name="channelId" value={filters.channelId} /> : null}
      {filters.startInput ? <input type="hidden" name="start" value={filters.startInput} /> : null}
      {filters.endInput ? <input type="hidden" name="end" value={filters.endInput} /> : null}
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
