"use client";

import { useMemo, useState } from "react";

import {
  TokenDetailDialog,
  useTokenDetailDialog,
} from "@/components/dashboard/token-detail-dialog";
import { formatCompactNumber, formatDateTime, formatQuota } from "@/lib/format";
import type { TokenRankingRow } from "@/lib/queries/dashboard";

interface TokenRankingTableProps {
  rows: TokenRankingRow[];
}

type SortKey =
  | "rank"
  | "tokenName"
  | "username"
  | "requestCount"
  | "totalTokens"
  | "totalQuota"
  | "latestUsedAt";

type SortDirection = "asc" | "desc";

const defaultDirectionByKey: Record<SortKey, SortDirection> = {
  rank: "asc",
  tokenName: "asc",
  username: "asc",
  requestCount: "desc",
  totalTokens: "desc",
  totalQuota: "desc",
  latestUsedAt: "desc",
};

const sortLabels: Record<SortKey, string> = {
  rank: "排名",
  tokenName: "密钥",
  username: "用户",
  requestCount: "请求",
  totalTokens: "令牌",
  totalQuota: "配额",
  latestUsedAt: "最近调用",
};

export function TokenRankingTable({ rows }: TokenRankingTableProps) {
  const leader = rows[0];
  const { selectedRow, openRow, closeRow, isOpen } = useTokenDetailDialog();
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        let result = 0;

        switch (sortKey) {
          case "rank":
            result = left.index - right.index;
            break;
          case "tokenName":
            result = left.row.tokenName.localeCompare(right.row.tokenName, "zh-CN");
            break;
          case "username":
            result = left.row.username.localeCompare(right.row.username, "zh-CN");
            break;
          case "requestCount":
            result = left.row.requestCount - right.row.requestCount;
            break;
          case "totalTokens":
            result = left.row.totalTokens - right.row.totalTokens;
            break;
          case "totalQuota":
            result = left.row.totalQuota - right.row.totalQuota;
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
  }, [rows, sortDirection, sortKey]);

  function handleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(defaultDirectionByKey[nextKey]);
  }

  function handleMobileSortChange(nextKey: SortKey) {
    setSortKey(nextKey);
    setSortDirection(defaultDirectionByKey[nextKey]);
  }

  return (
    <>
      <section className="relative overflow-hidden rounded-[1.35rem] border border-[#273140] bg-[linear-gradient(180deg,rgba(6,10,15,0.985),rgba(8,13,20,0.985))] shadow-[0_40px_140px_rgba(0,0,0,0.45)] sm:rounded-[1.8rem]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:22px_22px] opacity-[0.18]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(125,211,252,0.09),transparent)]" />

        <div className="relative border-b border-white/6 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[0.58rem] uppercase tracking-[0.28em] text-slate-500 sm:text-[0.64rem] sm:tracking-[0.32em]">
                主榜
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                <h2 className="[font-family:var(--font-code)] text-[1.3rem] font-semibold uppercase leading-none tracking-[0.12em] text-white sm:text-[2.3rem] sm:tracking-[0.16em]">
                  排行
                </h2>
              </div>
            </div>

            {leader ? (
              <div className="grid w-full gap-2 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3 sm:grid-cols-3 sm:px-4 xl:min-w-[320px] xl:w-auto">
                <MetricChip label="榜首" value={leader.tokenName} tone="text-cyan-200" />
                <MetricChip label="令牌" value={formatCompactNumber(leader.totalTokens)} tone="text-white" />
                <MetricChip label="请求" value={leader.requestCount.toLocaleString("zh-CN")} tone="text-amber-200" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative px-2 py-2 sm:px-3 sm:py-3">
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_92px] gap-2 rounded-[1rem] border border-white/8 bg-black/25 p-2.5 md:hidden">
            <label className="space-y-1 text-[0.58rem] tracking-[0.18em] text-slate-500">
              <span>排序</span>
              <select
                value={sortKey}
                onChange={(event) => handleMobileSortChange(event.target.value as SortKey)}
                className="h-10 w-full rounded-[0.85rem] border border-white/8 bg-slate-950/90 px-3 text-[0.76rem] text-slate-100 outline-none transition focus:border-cyan-300/60 focus:bg-black"
              >
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
              className="inline-flex h-10 self-end items-center justify-center rounded-[0.85rem] border border-white/8 bg-white/[0.03] px-3 text-[0.72rem] font-medium tracking-[0.12em] text-slate-200 transition hover:border-white/18 hover:bg-white/[0.06]"
            >
              {sortDirection === "desc" ? "降序" : "升序"}
            </button>
          </div>

          <div className="space-y-2.5 md:hidden">
            {sortedRows.map((row, index) => (
              <button
                key={`${row.tokenId}-${row.tokenName}`}
                type="button"
                onClick={() => openRow(row)}
                className="w-full rounded-[1rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-3 text-left transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] active:scale-[0.995]"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-[0.8rem] border border-white/10 bg-black/45 px-2 [font-family:var(--font-code)] text-[0.78rem] font-semibold text-white">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[0.98rem] font-semibold text-white">{row.tokenName}</p>
                        <p className="mt-1 [font-family:var(--font-code)] text-[0.66rem] uppercase tracking-[0.14em] text-slate-500">
                          编号 {row.tokenId}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-[0.56rem] uppercase tracking-[0.2em] text-slate-600">令牌</p>
                        <p className="mt-1 [font-family:var(--font-code)] text-[0.94rem] font-semibold text-cyan-300">
                          {formatCompactNumber(row.totalTokens)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-slate-400">
                      <span className="text-slate-100">{row.username}</span>
                      {row.displayName ? <span>{row.displayName}</span> : null}
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <MobileMetric label="请求" value={row.requestCount.toLocaleString("zh-CN")} />
                      <MobileMetric label="配额" value={formatQuota(row.totalQuota)} />
                      <MobileMetric label="最近" value={formatDateTime(row.latestUsedAt)} />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[780px] border-separate border-spacing-y-2 text-left text-sm text-slate-200 lg:min-w-full">
              <thead>
                <tr className="text-[0.62rem] uppercase tracking-[0.24em] text-slate-500">
                  <SortableHeader
                    label="#"
                    sortKey="rank"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="密钥"
                    sortKey="tokenName"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="用户"
                    sortKey="username"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    align="right"
                    label="请求"
                    sortKey="requestCount"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    align="right"
                    label="令牌"
                    sortKey="totalTokens"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    align="right"
                    label="配额"
                    sortKey="totalQuota"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="最近调用"
                    sortKey="latestUsedAt"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={`${row.tokenId}-${row.tokenName}`} className="group">
                    <td className="rounded-l-[1rem] border border-r-0 border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 align-top group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-[0.8rem] border border-white/10 bg-black/45 px-2 [font-family:var(--font-code)] text-[0.78rem] font-semibold text-white">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td className="border-y border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      <button
                        type="button"
                        onClick={() => openRow(row)}
                        className="flex w-full cursor-pointer flex-col gap-1 rounded-[0.8rem] px-1 py-1 text-left transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                      >
                        <span className="text-[0.96rem] font-semibold text-white transition group-hover:text-cyan-200">
                          {row.tokenName}
                        </span>
                        <span className="[font-family:var(--font-code)] text-[0.68rem] uppercase tracking-[0.16em] text-slate-500 transition group-hover:text-slate-300">
                          编号 {row.tokenId}
                        </span>
                      </button>
                    </td>
                    <td className="border-y border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-100">{row.username}</span>
                        <span className="text-[0.72rem] text-slate-500">{row.displayName || "-"}</span>
                      </div>
                    </td>
                    <td className="border-y border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 text-right [font-family:var(--font-code)] text-[0.8rem] text-slate-300 group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      {row.requestCount.toLocaleString("zh-CN")}
                    </td>
                    <td className="border-y border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 text-right [font-family:var(--font-code)] text-[0.92rem] font-semibold text-cyan-300 group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      {formatCompactNumber(row.totalTokens)}
                    </td>
                    <td className="border-y border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 text-right [font-family:var(--font-code)] text-[0.78rem] text-slate-300 group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      {formatQuota(row.totalQuota)}
                    </td>
                    <td className="rounded-r-[1rem] border border-l-0 border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 py-3 text-[0.72rem] text-slate-400 group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.08]">
                      {formatDateTime(row.latestUsedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <TokenDetailDialog row={selectedRow} open={isOpen} onClose={closeRow} />
    </>
  );
}

interface MetricChipProps {
  label: string;
  value: string;
  tone: string;
}

function MetricChip({ label, value, tone }: MetricChipProps) {
  return (
    <div className="space-y-1">
      <p className="text-[0.54rem] uppercase tracking-[0.18em] text-slate-600 sm:text-[0.58rem] sm:tracking-[0.22em]">
        {label}
      </p>
      <p className={`truncate [font-family:var(--font-code)] text-[0.82rem] font-semibold uppercase tracking-[0.06em] sm:text-[0.86rem] sm:tracking-[0.08em] ${tone}`}>
        {value}
      </p>
    </div>
  );
}

interface MobileMetricProps {
  label: string;
  value: string;
}

function MobileMetric({ label, value }: MobileMetricProps) {
  return (
    <div className="rounded-[0.8rem] border border-white/6 bg-black/20 px-2.5 py-2">
      <p className="text-[0.54rem] uppercase tracking-[0.18em] text-slate-600">{label}</p>
      <p className="mt-1 text-[0.72rem] text-slate-300">{value}</p>
    </div>
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
    <th className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition hover:text-slate-300 ${align === "right" ? "ml-auto" : ""}`}
      >
        <span>{label}</span>
        <span className={`text-[0.7rem] ${isActive ? "text-cyan-300" : "text-slate-600"}`}>
          {indicator}
        </span>
      </button>
    </th>
  );
}
