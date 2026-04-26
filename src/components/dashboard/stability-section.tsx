"use client";

import { useMemo, useState } from "react";

import {
  formatCompactNumber,
  formatDateTime,
  formatDurationMsAsSeconds,
  formatDurationSeconds,
  formatInteger,
  formatPercent,
  formatStatus,
} from "@/lib/format";
import type {
  ChannelStabilityRow,
  ModelStabilityRow,
} from "@/lib/queries/dashboard";

interface StabilitySectionProps {
  modelRows: ModelStabilityRow[];
  channelRows: ChannelStabilityRow[];
}

type DimensionKey = "model" | "channel";
type SortKey =
  | "rank"
  | "name"
  | "info"
  | "totalAttempts"
  | "errorCount"
  | "availabilityRate"
  | "avgFirstTokenLatency"
  | "avgTotalResponseTime"
  | "avgOutputTokensPerSec"
  | "latestUsedAt";
type SortDirection = "asc" | "desc";

interface StabilityViewRow {
  key: string;
  name: string;
  info: string;
  totalAttempts: number;
  errorCount: number;
  availabilityRate: number;
  avgFirstTokenLatency: number | null;
  avgTotalResponseTime: number | null;
  avgOutputTokensPerSec: number | null;
  latestUsedAt: number;
}

interface StabilityViewConfig {
  nameLabel: string;
  infoLabel: string;
  rows: StabilityViewRow[];
}

const dimensionTabs: Array<{ key: DimensionKey; label: string }> = [
  { key: "model", label: "模型稳定性" },
  { key: "channel", label: "渠道稳定性" },
];

const defaultSortState: Record<DimensionKey, { key: SortKey; direction: SortDirection }> = {
  model: { key: "totalAttempts", direction: "desc" },
  channel: { key: "totalAttempts", direction: "desc" },
};

const sortLabelsByDimension: Record<DimensionKey, Record<SortKey, string>> = {
  model: {
    rank: "排名",
    name: "模型",
    info: "说明",
    totalAttempts: "请求",
    errorCount: "错误",
    availabilityRate: "可用率",
    avgFirstTokenLatency: "首 Token",
    avgTotalResponseTime: "总耗时",
    avgOutputTokensPerSec: "输出 tok/s",
    latestUsedAt: "最近调用",
  },
  channel: {
    rank: "排名",
    name: "渠道",
    info: "状态",
    totalAttempts: "请求",
    errorCount: "错误",
    availabilityRate: "可用率",
    avgFirstTokenLatency: "首 Token",
    avgTotalResponseTime: "总耗时",
    avgOutputTokensPerSec: "输出 tok/s",
    latestUsedAt: "最近调用",
  },
};

function getAvailabilityRate(errorRate: number | null | undefined) {
  if (errorRate === null || errorRate === undefined || !Number.isFinite(errorRate)) {
    return 0;
  }

  return Math.max(0, Math.min(1, 1 - errorRate));
}

function formatAvailabilityRate(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return formatPercent(value);
}

function formatOutputTokensPerSec(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return formatCompactNumber(value);
}

function sortRows(rows: StabilityViewRow[], sortKey: SortKey, sortDirection: SortDirection) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let result = 0;

      switch (sortKey) {
        case "rank":
          result = left.index - right.index;
          break;
        case "name":
          result = left.row.name.localeCompare(right.row.name, "zh-CN");
          break;
        case "info":
          result = left.row.info.localeCompare(right.row.info, "zh-CN");
          break;
        case "totalAttempts":
          result = left.row.totalAttempts - right.row.totalAttempts;
          break;
        case "errorCount":
          result = left.row.errorCount - right.row.errorCount;
          break;
        case "availabilityRate":
          result = left.row.availabilityRate - right.row.availabilityRate;
          break;
        case "avgFirstTokenLatency":
          result = (left.row.avgFirstTokenLatency ?? -1) - (right.row.avgFirstTokenLatency ?? -1);
          break;
        case "avgTotalResponseTime":
          result = (left.row.avgTotalResponseTime ?? -1) - (right.row.avgTotalResponseTime ?? -1);
          break;
        case "avgOutputTokensPerSec":
          result = (left.row.avgOutputTokensPerSec ?? -1) - (right.row.avgOutputTokensPerSec ?? -1);
          break;
        case "latestUsedAt":
          result = left.row.latestUsedAt - right.row.latestUsedAt;
          break;
        default:
          result = 0;
      }

      if (result === 0) {
        result = left.index - right.index;
      }

      return sortDirection === "asc" ? result : -result;
    })
    .map((item) => item.row);
}

export function StabilitySection({ modelRows, channelRows }: StabilitySectionProps) {
  const [activeDimension, setActiveDimension] = useState<DimensionKey>("model");
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortState.model.key);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortState.model.direction);

  const views: Record<DimensionKey, StabilityViewConfig> = useMemo(
    () => ({
      model: {
        nameLabel: "模型",
        infoLabel: "说明",
        rows: modelRows.map((row) => ({
          key: row.modelName,
          name: row.modelName,
          info: `${formatInteger(row.successCount)} 成功`,
          totalAttempts: row.totalAttempts,
          errorCount: row.errorCount,
          availabilityRate: getAvailabilityRate(row.errorRate),
          avgFirstTokenLatency: row.avgFirstTokenLatency,
          avgTotalResponseTime: row.avgTotalResponseTime,
          avgOutputTokensPerSec: row.avgOutputTokensPerSec,
          latestUsedAt: row.latestUsedAt,
        })),
      },
      channel: {
        nameLabel: "渠道",
        infoLabel: "状态",
        rows: channelRows.map((row) => ({
          key: String(row.channelId),
          name: row.channelName,
          info: `${formatStatus(row.status)} · 类型 ${row.type}`,
          totalAttempts: row.totalAttempts,
          errorCount: row.errorCount,
          availabilityRate: getAvailabilityRate(row.errorRate),
          avgFirstTokenLatency: row.avgFirstTokenLatency,
          avgTotalResponseTime: row.avgTotalResponseTime,
          avgOutputTokensPerSec: row.avgOutputTokensPerSec,
          latestUsedAt: row.latestUsedAt,
        })),
      },
    }),
    [channelRows, modelRows],
  );

  const activeView = views[activeDimension];
  const sortedRows = useMemo(
    () => sortRows(activeView.rows, sortKey, sortDirection),
    [activeView, sortDirection, sortKey],
  );
  const leader = sortedRows[0];
  const activeSortLabels = sortLabelsByDimension[activeDimension];

  function handleDimensionChange(nextDimension: DimensionKey) {
    setActiveDimension(nextDimension);
    setSortKey(defaultSortState[nextDimension].key);
    setSortDirection(defaultSortState[nextDimension].direction);
  }

  function handleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(defaultSortState[activeDimension].direction);
  }

  function handleMobileSortChange(nextKey: SortKey) {
    setSortKey(nextKey);
    setSortDirection(defaultSortState[activeDimension].direction);
  }

  return (
    <section className="ds-panel overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1rem] leading-none tracking-[-0.05em] sm:text-[1.18rem]">
          {dimensionTabs.map((tab, index) => {
            const isActive = tab.key === activeDimension;

            return (
              <div key={tab.key} className="flex items-center gap-x-2 gap-y-1">
                {index > 0 ? <span className="text-[var(--foreground-faint)]">/</span> : null}
                <button
                  type="button"
                  onClick={() => handleDimensionChange(tab.key)}
                  className={`cursor-pointer transition ${
                    isActive
                      ? "ds-tab-active-text text-[var(--foreground)]"
                      : "font-medium text-[var(--foreground-faint)] hover:text-[var(--foreground-soft)]"
                  }`}
                >
                  {tab.label}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="ds-kicker">稳定性</p>
          </div>
          {leader ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.78rem] text-[var(--foreground-soft)]">
              <span>
                榜首 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{leader.name}</span>
              </span>
              <span>
                请求 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatInteger(leader.totalAttempts)}</span>
              </span>
              <span>
                可用率 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatAvailabilityRate(leader.availabilityRate)}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2 md:hidden">
        <label className="space-y-1.5 text-[0.68rem] font-medium text-[var(--foreground-soft)]">
          <span>排序</span>
          <select
            value={sortKey}
            onChange={(event) => handleMobileSortChange(event.target.value as SortKey)}
            className="ds-input h-10 appearance-none px-3 text-[0.8rem]"
          >
            {Object.entries(activeSortLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
          className="ds-button-secondary h-10 self-end px-3 text-[0.74rem] font-medium"
        >
          {sortDirection === "desc" ? "降序" : "升序"}
        </button>
      </div>

      <div key={`mobile-${activeDimension}`} className="space-y-3 md:hidden">
        {sortedRows.map((row, index) => (
          <article key={`${activeDimension}-${row.key}`} className="ds-mobile-row p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                  <p className="truncate text-[0.96rem] font-semibold text-[var(--foreground)]">{row.name}</p>
                </div>
                <p className="mt-1 text-[0.76rem] text-[var(--foreground-muted)]">{row.info}</p>
              </div>

              <div className="shrink-0 text-right">
                <p className="ds-kicker text-[0.56rem] text-[var(--foreground-faint)]">可用率</p>
                <p className="mt-1.5 ds-mono text-[0.96rem] font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                  {formatAvailabilityRate(row.availabilityRate)}
                </p>
              </div>
            </div>

            <div className="ds-mobile-meta mt-3 grid grid-cols-2 gap-2 pt-3 text-[0.74rem] text-[var(--foreground-soft)]">
              <span>
                请求 <span className="ml-1 ds-mono text-[var(--foreground)]">{formatInteger(row.totalAttempts)}</span>
              </span>
              <span className="text-right">
                错误 <span className="ml-1 ds-mono text-[var(--foreground)]">{formatInteger(row.errorCount)}</span>
              </span>
              <span>
                首 Token <span className="ml-1 ds-mono text-[var(--foreground)]">{formatDurationMsAsSeconds(row.avgFirstTokenLatency)}</span>
              </span>
              <span className="text-right">
                总耗时 <span className="ml-1 ds-mono text-[var(--foreground)]">{formatDurationSeconds(row.avgTotalResponseTime)}</span>
              </span>
              <span>
                输出 tok/s <span className="ml-1 ds-mono text-[var(--foreground)]">{formatOutputTokensPerSec(row.avgOutputTokensPerSec)}</span>
              </span>
              <span className="col-span-2 text-right">{formatDateTime(row.latestUsedAt)}</span>
            </div>
          </article>
        ))}
      </div>

      <div key={`desktop-${activeDimension}`} className="hidden md:block">
        <div className="ds-table-shell overflow-x-auto">
          <table className="min-w-[1060px] w-full border-collapse text-left text-sm text-[var(--foreground)]">
            <thead>
              <tr className="text-[0.64rem] uppercase tracking-[0.16em] text-[var(--foreground-faint)]">
                <SortableHeader label="#" sortKey="rank" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label={activeView.nameLabel} sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label={activeView.infoLabel} sortKey="info" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label="请求" sortKey="totalAttempts" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortableHeader label="错误" sortKey="errorCount" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortableHeader label="可用率" sortKey="availabilityRate" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortableHeader label="首 Token" sortKey="avgFirstTokenLatency" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortableHeader label="总耗时" sortKey="avgTotalResponseTime" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortableHeader label="输出 tok/s" sortKey="avgOutputTokensPerSec" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortableHeader label="最近调用" sortKey="latestUsedAt" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, index) => (
                <tr key={`${activeDimension}-${row.key}`} className="ds-table-row align-top">
                  <td className="px-4 py-3">
                    <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[0.95rem] font-semibold text-[var(--foreground)]">{row.name}</span>
                  </td>
                  <td className="px-4 py-3 text-[0.78rem] text-[var(--foreground-muted)]">{row.info || "-"}</td>
                  <td className="px-4 py-3 text-right ds-mono text-[0.78rem] text-[var(--foreground-muted)]">{formatInteger(row.totalAttempts)}</td>
                  <td className="px-4 py-3 text-right ds-mono text-[0.78rem] text-[var(--foreground-muted)]">{formatInteger(row.errorCount)}</td>
                  <td className="px-4 py-3 text-right ds-mono text-[0.94rem] font-semibold tracking-[-0.05em] text-[var(--foreground)]">{formatAvailabilityRate(row.availabilityRate)}</td>
                  <td className="px-4 py-3 text-right ds-mono text-[0.78rem] text-[var(--foreground-muted)]">{formatDurationMsAsSeconds(row.avgFirstTokenLatency)}</td>
                  <td className="px-4 py-3 text-right ds-mono text-[0.78rem] text-[var(--foreground-muted)]">{formatDurationSeconds(row.avgTotalResponseTime)}</td>
                  <td className="px-4 py-3 text-right ds-mono text-[0.78rem] text-[var(--foreground-muted)]">{formatOutputTokensPerSec(row.avgOutputTokensPerSec)}</td>
                  <td className="px-4 py-3 text-[0.74rem] text-[var(--foreground-soft)]">{formatDateTime(row.latestUsedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (sortKey: SortKey) => void;
  align?: "left" | "right";
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
}: SortableHeaderProps) {
  const isActive = activeKey === sortKey;
  const indicator = !isActive ? "↕" : direction === "asc" ? "↑" : "↓";

  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition hover:text-[var(--foreground)] ${align === "right" ? "ml-auto" : ""}`}
      >
        <span>{label}</span>
        <span className={`text-[0.72rem] ${isActive ? "text-[var(--foreground)]" : "text-[var(--foreground-faint)]"}`}>
          {indicator}
        </span>
      </button>
    </th>
  );
}
