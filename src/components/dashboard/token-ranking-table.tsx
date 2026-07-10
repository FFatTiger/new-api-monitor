"use client";

import { useMemo, useState } from "react";

import {
  TokenDetailDialog,
  useTokenDetailDialog,
} from "@/components/dashboard/token-detail-dialog";
import { formatCompactNumber, formatDateTime, formatOutputTokensPerSec, formatPercent, formatStatus, getCacheRatio } from "@/lib/format";
import type {
  ChannelRankingRow,
  ModelRankingRow,
  TokenRankingRow,
  UserRankingRow,
} from "@/lib/queries/dashboard";

interface TokenRankingTableProps {
  tokenRows: TokenRankingRow[];
  userRows: UserRankingRow[];
  modelRows: ModelRankingRow[];
  channelRows: ChannelRankingRow[];
}

type DimensionKey = "token" | "user" | "model" | "channel";
type SortKey = "rank" | "name" | "info" | "requestCount" | "totalTokens" | "outputTokensPerSec" | "latestUsedAt";
type SortDirection = "asc" | "desc";

interface RankingViewRow {
  key: string;
  name: string;
  info: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheTokens: number;
  outputTokensPerSec: number | null;
  latestUsedAt: number;
  onSelect?: () => void;
}

interface RankingViewConfig {
  nameLabel: string;
  infoLabel: string | null;
  rows: RankingViewRow[];
  sortKeys: SortKey[];
}

const dimensionTabs: Array<{ key: DimensionKey; label: string }> = [
  { key: "token", label: "密钥排行" },
  { key: "user", label: "用户排行" },
  { key: "model", label: "模型排行" },
  { key: "channel", label: "渠道排行" },
];

const defaultSortState: Record<DimensionKey, { key: SortKey; direction: SortDirection }> = {
  token: { key: "totalTokens", direction: "desc" },
  user: { key: "totalTokens", direction: "desc" },
  model: { key: "totalTokens", direction: "desc" },
  channel: { key: "totalTokens", direction: "desc" },
};

const sortLabelsByDimension: Record<DimensionKey, Record<SortKey, string>> = {
  token: {
    rank: "排名",
    name: "密钥",
    info: "用户",
    requestCount: "请求",
    totalTokens: "总令牌",
    outputTokensPerSec: "输出 tok/s",
    latestUsedAt: "最近调用",
  },
  user: {
    rank: "排名",
    name: "用户",
    info: "显示名",
    requestCount: "请求",
    totalTokens: "总令牌",
    outputTokensPerSec: "输出 tok/s",
    latestUsedAt: "最近调用",
  },
  model: {
    rank: "排名",
    name: "模型",
    info: "说明",
    requestCount: "请求",
    totalTokens: "总令牌",
    outputTokensPerSec: "输出 tok/s",
    latestUsedAt: "最近调用",
  },
  channel: {
    rank: "排名",
    name: "渠道",
    info: "状态",
    requestCount: "请求",
    totalTokens: "总令牌",
    outputTokensPerSec: "输出 tok/s",
    latestUsedAt: "最近调用",
  },
};

function sortRows(rows: RankingViewRow[], sortKey: SortKey, sortDirection: SortDirection) {
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
        case "requestCount":
          result = left.row.requestCount - right.row.requestCount;
          break;
        case "totalTokens":
          result = left.row.totalTokens - right.row.totalTokens;
          break;
        case "outputTokensPerSec":
          result = (left.row.outputTokensPerSec ?? -1) - (right.row.outputTokensPerSec ?? -1);
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

export function TokenRankingTable({ tokenRows, userRows, modelRows, channelRows }: TokenRankingTableProps) {
  const { selectedRow, openRow, closeRow, isOpen } = useTokenDetailDialog();
  const [activeDimension, setActiveDimension] = useState<DimensionKey>("token");
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortState.token.key);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortState.token.direction);

  const tokenViewRows = useMemo<RankingViewRow[]>(
    () =>
      tokenRows.map((row) => ({
        key: `${row.tokenId}-${row.tokenName}`,
        name: row.tokenName,
        info: row.username,
        requestCount: row.requestCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cacheTokens: row.cacheTokens,
        outputTokensPerSec: row.outputTokensPerSec,
        latestUsedAt: row.latestUsedAt,
        onSelect: () => openRow(row),
      })),
    [openRow, tokenRows],
  );

  const userViewRows = useMemo<RankingViewRow[]>(
    () =>
      userRows.map((row) => ({
        key: String(row.userId),
        name: row.username,
        info: "",
        requestCount: row.requestCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cacheTokens: row.cacheTokens,
        outputTokensPerSec: row.outputTokensPerSec,
        latestUsedAt: row.latestUsedAt,
      })),
    [userRows],
  );

  const modelViewRows = useMemo<RankingViewRow[]>(
    () =>
      modelRows.map((row) => ({
        key: row.modelName,
        name: row.modelName,
        info: "",
        requestCount: row.requestCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cacheTokens: row.cacheTokens,
        outputTokensPerSec: row.outputTokensPerSec,
        latestUsedAt: row.latestUsedAt,
      })),
    [modelRows],
  );

  const channelViewRows = useMemo<RankingViewRow[]>(
    () =>
      channelRows.map((row) => ({
        key: String(row.channelId),
        name: row.channelName,
        info: formatStatus(row.status),
        requestCount: row.requestCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cacheTokens: row.cacheTokens,
        outputTokensPerSec: row.outputTokensPerSec,
        latestUsedAt: row.latestUsedAt,
      })),
    [channelRows],
  );

  const rankingViews: Record<DimensionKey, RankingViewConfig> = useMemo(
    () => ({
      token: {
        nameLabel: "密钥",
        infoLabel: "用户",
        rows: tokenViewRows,
        sortKeys: ["rank", "name", "info", "requestCount", "totalTokens", "latestUsedAt"],
      },
      user: {
        nameLabel: "用户",
        infoLabel: null,
        rows: userViewRows,
        sortKeys: ["rank", "name", "requestCount", "totalTokens", "latestUsedAt"],
      },
      model: {
        nameLabel: "模型",
        infoLabel: null,
        rows: modelViewRows,
        sortKeys: ["rank", "name", "requestCount", "totalTokens", "outputTokensPerSec", "latestUsedAt"],
      },
      channel: {
        nameLabel: "渠道",
        infoLabel: "状态",
        rows: channelViewRows,
        sortKeys: ["rank", "name", "info", "requestCount", "totalTokens", "outputTokensPerSec", "latestUsedAt"],
      },
    }),
    [channelViewRows, modelViewRows, tokenViewRows, userViewRows],
  );

  const activeView = rankingViews[activeDimension];
  const sortedRows = useMemo(
    () => sortRows(activeView.rows, sortKey, sortDirection),
    [activeView, sortDirection, sortKey],
  );
  const leader = sortedRows[0];

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

  const activeSortLabels = sortLabelsByDimension[activeDimension];

  return (
    <>
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

          {leader ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem] text-[var(--foreground-soft)]">
              <span>
                榜首 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{leader.name}</span>
              </span>
              <span>
                输入 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatCompactNumber(leader.inputTokens)}</span>
              </span>
              <span>
                输出 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatCompactNumber(leader.outputTokens)}</span>
              </span>
              <span>
                总令牌 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{formatCompactNumber(leader.totalTokens)}</span>
              </span>
              <span>
                请求 <span className="ml-1 ds-mono font-semibold text-[var(--foreground)]">{leader.requestCount.toLocaleString("zh-CN")}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="mb-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2 md:hidden">
          <label className="space-y-1.5 text-[0.68rem] font-medium text-[var(--foreground-soft)]">
            <span>排序</span>
            <select
              value={sortKey}
              onChange={(event) => handleMobileSortChange(event.target.value as SortKey)}
              className="ds-input h-10 appearance-none px-3 text-[0.8rem]"
            >
              {activeView.sortKeys.map((key) => (
                <option key={key} value={key}>
                  {activeSortLabels[key]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
            className="ds-button-secondary h-10 self-end px-3 text-[0.79rem] font-medium"
          >
            {sortDirection === "desc" ? "降序" : "升序"}
          </button>
        </div>

        <div key={`mobile-${activeDimension}`} className="space-y-3 md:hidden">
          {sortedRows.map((row, index) => {
            const content = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                      <p className="truncate text-[0.96rem] font-semibold text-[var(--foreground)]">{row.name}</p>
                    </div>
                    {row.info ? <p className="mt-1 text-[0.81rem] text-[var(--foreground-muted)]">{row.info}</p> : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="ds-kicker text-[0.56rem] text-[var(--foreground-faint)]">总令牌</p>
                    <p className="mt-1.5 ds-mono text-[0.96rem] font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                      {formatCompactNumber(row.totalTokens)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-[0.77rem] text-[var(--foreground-soft)]">
                  <span>
                    输入 <span className="ml-1 ds-mono text-[var(--foreground)]">{formatCompactNumber(row.inputTokens)}</span>
                  </span>
                  <span className="text-center">
                    Cache <span className="ml-1 ds-mono text-[var(--foreground)]">{formatPercent(getCacheRatio(row.inputTokens, row.cacheTokens))}</span>
                  </span>
                  <span className="text-right">
                    输出 <span className="ml-1 ds-mono text-[var(--foreground)]">{formatCompactNumber(row.outputTokens)}</span>
                  </span>
                </div>

                <div className="ds-mobile-meta mt-3 grid grid-cols-2 gap-2 pt-3 text-[0.79rem] text-[var(--foreground-soft)]">
                  <span>
                    请求 <span className="ml-1 ds-mono text-[var(--foreground)]">{row.requestCount.toLocaleString("zh-CN")}</span>
                  </span>
                  <span className="text-right">{formatDateTime(row.latestUsedAt)}</span>
                  {(activeDimension === "model" || activeDimension === "channel") && row.outputTokensPerSec != null ? (
                    <span>
                      输出 tok/s <span className="ml-1 ds-mono text-[var(--foreground)]">{formatOutputTokensPerSec(row.outputTokensPerSec)}</span>
                    </span>
                  ) : null}
                </div>
              </>
            );

            if (row.onSelect) {
              return (
                <button
                  key={`${activeDimension}-${row.key}`}
                  type="button"
                  onClick={row.onSelect}
                  className="ds-mobile-row w-full p-4 text-left active:scale-[0.995]"
                >
                  {content}
                </button>
              );
            }

            return (
              <article key={`${activeDimension}-${row.key}`} className="ds-mobile-row p-4">
                {content}
              </article>
            );
          })}
        </div>

        <div key={`desktop-${activeDimension}`} className="hidden md:block">
          <div className="ds-table-shell overflow-x-auto">
            <table className="min-w-[1160px] w-full border-collapse text-left text-sm text-[var(--foreground)]">
              <thead>
                <tr className="text-[0.7rem] uppercase tracking-[0.16em] text-[var(--foreground-faint)]">
                  <SortableHeader label="#" sortKey="rank" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                  <SortableHeader
                    label={activeView.nameLabel}
                    sortKey="name"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  {activeView.infoLabel ? (
                    <SortableHeader
                      label={activeView.infoLabel}
                      sortKey="info"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSort}
                    />
                  ) : null}
                  <SortableHeader label="请求" sortKey="requestCount" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                  <th className="px-4 py-3 text-right">输入</th>
                  <th className="px-4 py-3 text-right">Cache</th>
                  <th className="px-4 py-3 text-right">输出</th>
                  <SortableHeader label="总令牌" sortKey="totalTokens" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                  {(activeDimension === "model" || activeDimension === "channel") ? (
                    <SortableHeader label="输出 tok/s" sortKey="outputTokensPerSec" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                  ) : null}
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
                  <tr key={`${activeDimension}-${row.key}`} className="ds-table-row align-top">
                    <td className="px-4 py-3">
                      <span className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</span>
                    </td>
                    <td className="px-4 py-3">
                      {row.onSelect ? (
                        <button
                          type="button"
                          onClick={row.onSelect}
                          className="flex w-full cursor-pointer flex-col gap-1 text-left transition hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-color)]"
                        >
                          <span className="text-[0.95rem] font-semibold text-[var(--foreground)]">{row.name}</span>
                        </button>
                      ) : (
                        <span className="text-[0.95rem] font-semibold text-[var(--foreground)]">{row.name}</span>
                      )}
                    </td>
                    {activeView.infoLabel ? (
                      <td className="px-4 py-3 text-[0.82rem] text-[var(--foreground-muted)]">{row.info || "-"}</td>
                    ) : null}
                    <td className="px-4 py-3 text-right ds-mono text-[0.82rem] text-[var(--foreground-muted)]">
                      {row.requestCount.toLocaleString("zh-CN")}
                    </td>
                    <td className="px-4 py-3 text-right ds-mono text-[0.82rem] text-[var(--foreground-muted)]">
                      {formatCompactNumber(row.inputTokens)}
                    </td>
                    <td className="px-4 py-3 text-right ds-mono text-[0.82rem] text-[var(--foreground-muted)]">
                      {formatPercent(getCacheRatio(row.inputTokens, row.cacheTokens))}
                    </td>
                    <td className="px-4 py-3 text-right ds-mono text-[0.82rem] text-[var(--foreground-muted)]">
                      {formatCompactNumber(row.outputTokens)}
                    </td>
                    <td className="px-4 py-3 text-right ds-mono text-[0.94rem] font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                      {formatCompactNumber(row.totalTokens)}
                    </td>
                    {(activeDimension === "model" || activeDimension === "channel") ? (
                      <td className="px-4 py-3 text-right ds-mono text-[0.82rem] text-[var(--foreground-muted)]">
                        {formatOutputTokensPerSec(row.outputTokensPerSec)}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-[0.79rem] text-[var(--foreground-soft)]">{formatDateTime(row.latestUsedAt)}</td>
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
        <span className={`text-[0.77rem] ${isActive ? "text-[var(--foreground)]" : "text-[var(--foreground-faint)]"}`}>
          {indicator}
        </span>
      </button>
    </th>
  );
}
