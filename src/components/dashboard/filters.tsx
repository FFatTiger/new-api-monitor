"use client";

import Link from "next/link";
import { useState } from "react";

import type { DashboardFilters, FilterOption, FilterPreset } from "@/lib/queries/dashboard";

interface DashboardFiltersBarProps {
  filters: DashboardFilters;
  usernameOptions: FilterOption[];
  modelOptions: FilterOption[];
  channelOptions: FilterOption[];
}

const presets: Array<{ value: FilterPreset; label: string }> = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "all", label: "不限" },
  { value: "custom", label: "自定义" },
];

const fieldClass =
  "h-11 w-full rounded-[0.95rem] border border-white/8 bg-slate-950/90 px-3 text-[0.78rem] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:bg-black sm:rounded-[1rem]";

const labelClass = "space-y-1 text-[0.58rem] tracking-[0.16em] text-slate-500 sm:text-[0.62rem] sm:tracking-[0.2em]";

export function DashboardFiltersBar({
  filters,
  usernameOptions,
  modelOptions,
  channelOptions,
}: DashboardFiltersBarProps) {
  const [preset, setPreset] = useState<FilterPreset>(filters.preset);
  const showCustomDate = preset === "custom";

  return (
    <form
      className={
        showCustomDate
          ? "grid gap-2 sm:grid-cols-2 xl:grid-cols-[124px_minmax(0,1.35fr)_repeat(3,minmax(0,0.82fr))_146px_146px_minmax(0,220px)]"
          : "grid gap-2 sm:grid-cols-2 xl:grid-cols-[124px_minmax(0,1.55fr)_repeat(3,minmax(0,0.92fr))_minmax(0,220px)]"
      }
    >
      <label className={labelClass}>
        <span>时间范围</span>
        <select
          name="preset"
          value={preset}
          onChange={(event) => setPreset(event.target.value as FilterPreset)}
          className={fieldClass}
        >
          {presets.map((presetOption) => (
            <option key={presetOption.value} value={presetOption.value}>
              {presetOption.label}
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
        <select name="username" defaultValue={filters.username} className={fieldClass}>
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
        <select name="model" defaultValue={filters.model} className={fieldClass}>
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
        <select name="channelId" defaultValue={filters.channelId} className={fieldClass}>
          <option value="">全部</option>
          {channelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {showCustomDate ? (
        <>
          <label className={labelClass}>
            <span>开始时间</span>
            <input name="start" type="date" defaultValue={filters.startDate} className={fieldClass} />
          </label>

          <label className={labelClass}>
            <span>结束时间</span>
            <input name="end" type="date" defaultValue={filters.endDate} className={fieldClass} />
          </label>
        </>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1 xl:flex xl:items-end xl:justify-end">
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-[0.95rem] border border-cyan-300/25 bg-[linear-gradient(135deg,#9be6ff,#f3b86a)] px-4 text-[0.76rem] font-semibold tracking-[0.1em] text-slate-950 transition hover:brightness-105 sm:text-[0.78rem] sm:tracking-[0.12em] sm:rounded-[1rem] xl:min-w-[96px]"
        >
          应用
        </button>

        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-[0.95rem] border border-white/8 bg-white/[0.03] px-4 text-[0.76rem] font-medium tracking-[0.1em] text-slate-200 transition hover:border-white/18 hover:bg-white/[0.06] sm:text-[0.78rem] sm:tracking-[0.12em] sm:rounded-[1rem] xl:min-w-[96px]"
        >
          清空
        </Link>
      </div>
    </form>
  );
}
