"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  BreakdownPanel,
  DIALOG_EXIT_MS,
  DataCard,
  InlineSkeleton,
} from "@/components/dashboard/detail-dialog-shared";
import { useMountTransition } from "@/hooks/useMountTransition";
import { formatCompactNumber, formatDateTime, formatInputWithCache, formatStatus } from "@/lib/format";
import type { UserDetailData, UserRankingRow } from "@/lib/queries/dashboard";

interface UserDetailDialogProps {
  row: UserRankingRow | null;
  open: boolean;
  onClose: () => void;
  /** Ranking-scoped model filter that overrides the dashboard-level model filter. */
  modelOverride?: string;
}

export function UserDetailDialog({ row, open, onClose, modelOverride = "" }: UserDetailDialogProps) {
  const searchParams = useSearchParams();
  const [detailResult, setDetailResult] = useState<{ url: string; detail: UserDetailData | null; error: string | null } | null>(null);
  const [lastRow, setLastRow] = useState<UserRankingRow | null>(null);

  if (row !== null && row !== lastRow) {
    // Retain the last opened row so the dialog body stays valid while the exit
    // transition plays after `open` flips false.
    setLastRow(row);
  }

  const activeRow = open && row ? row : lastRow;
  const { mounted, visible } = useMountTransition(open && activeRow !== null, DIALOG_EXIT_MS);

  const detailUrl = useMemo(() => {
    if (!activeRow) return null;

    const params = new URLSearchParams(searchParams.toString());
    params.set("userId", String(activeRow.userId));
    params.set("username", activeRow.username);
    if (modelOverride) params.set("model", modelOverride);
    return `/api/user-detail?${params.toString()}`;
  }, [activeRow, modelOverride, searchParams]);

  useEffect(() => {
    if (!open || !detailUrl) {
      return;
    }

    const controller = new AbortController();

    fetch(detailUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("详情加载失败");
        return (await response.json()) as { detail?: UserDetailData };
      })
      .then((payload) => setDetailResult({ url: detailUrl, detail: payload.detail ?? null, error: null }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailResult({ url: detailUrl, detail: null, error: error instanceof Error ? error.message : String(error) });
      });

    return () => controller.abort();
  }, [detailUrl, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!mounted) {
    return null;
  }

  const currentRow = activeRow as UserRankingRow;
  const currentDetailResult = detailResult?.url === detailUrl ? detailResult : null;
  const userDetail = currentDetailResult?.detail ?? null;
  const detailError = currentDetailResult?.error ?? null;
  const detailLoading = !userDetail && !detailError;
  const averageInputTokens = currentRow.requestCount > 0 ? currentRow.inputTokens / currentRow.requestCount : 0;
  const averageOutputTokens = currentRow.requestCount > 0 ? currentRow.outputTokens / currentRow.requestCount : 0;
  const averageTotalTokens = currentRow.requestCount > 0 ? currentRow.totalTokens / currentRow.requestCount : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5">
      <div className="ds-overlay-panel ds-dialog-backdrop absolute inset-0" data-state={visible ? "open" : "closed"} onClick={onClose} />
      <div className="ds-overlay-card ds-dialog-card relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-[26px] sm:max-h-[90vh] sm:max-w-6xl sm:rounded-[28px]" data-state={visible ? "open" : "closed"}>
        <div className="ds-divider px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="ds-kicker">用户详情</p>
              <h3 className="mt-3 break-words text-[1.18rem] font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-[1.45rem]">
                {currentRow.username}
              </h3>
              <p className="mt-2 ds-mono text-[0.74rem] uppercase tracking-[0.08em] text-[var(--foreground-faint)]">
                编号 {currentRow.userId}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ds-icon-button h-9 w-9 shrink-0 text-[1rem]"
              aria-label="关闭详情弹窗"
            >
              ×
            </button>
          </div>
        </div>

        <div className="ds-dialog-grid p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
          <DataCard label="显示名" value={currentRow.displayName || "-"} subValue={currentRow.username} />
          <DataCard label="状态" value={formatStatus(currentRow.status)} subValue={`最近调用 ${formatDateTime(currentRow.latestUsedAt)}`} />
          <DataCard label="请求数" value={currentRow.requestCount.toLocaleString("zh-CN")} subValue="当前筛选窗口内" />
          <DataCard label="输入令牌" value={formatInputWithCache(currentRow.inputTokens, currentRow.cacheTokens)} subValue="当前筛选窗口内累计" />
          <DataCard label="输出令牌" value={formatCompactNumber(currentRow.outputTokens)} subValue="当前筛选窗口内累计" />
          <DataCard label="总令牌" value={formatCompactNumber(currentRow.totalTokens)} subValue="当前筛选窗口内累计" />
        </div>

        <div className="ds-divider ds-dialog-grid px-4 py-4 sm:px-6 sm:py-6 md:grid-cols-2 xl:grid-cols-5">
          <DataCard label="首次调用" value={detailLoading ? <InlineSkeleton /> : formatDateTime(userDetail?.firstUsedAt ?? 0)} subValue="当前筛选窗口内首次记录" />
          <DataCard label="平均输入 / 请求" value={formatCompactNumber(averageInputTokens)} subValue="当前筛选窗口内" />
          <DataCard label="平均输出 / 请求" value={formatCompactNumber(averageOutputTokens)} subValue="当前筛选窗口内" />
          <DataCard label="平均总令牌 / 请求" value={formatCompactNumber(averageTotalTokens)} subValue="当前筛选窗口内" />
          <DataCard label="活跃密钥数" value={detailLoading ? <InlineSkeleton /> : (userDetail?.activeTokenCount ?? 0).toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的密钥" />
        </div>

        {detailError ? <p className="px-4 py-3 text-sm text-red-500 sm:px-6">{detailError}</p> : null}

        <div className="ds-divider grid gap-4 px-4 py-4 sm:px-6 sm:py-6 xl:grid-cols-2">
          <BreakdownPanel
            loading={detailLoading}
            title="密钥调用排行"
            emptyText="当前筛选条件下没有密钥调用记录"
            rows={(userDetail?.tokens ?? []).map((token) => ({
              key: `${token.tokenId}-${token.tokenName}`,
              title: token.tokenName,
              metric: <>总 {formatCompactNumber(token.totalTokens)}</>,
              subMetric: (
                <>
                  输入 {formatInputWithCache(token.inputTokens, token.cacheTokens)} · 输出 {formatCompactNumber(token.outputTokens)}
                </>
              ),
              meta: `请求 ${token.requestCount.toLocaleString("zh-CN")} · 最近 ${formatDateTime(token.latestUsedAt)}`,
            }))}
          />

          <BreakdownPanel
            loading={detailLoading}
            title="模型调用排行"
            emptyText="当前筛选条件下没有模型调用记录"
            rows={(userDetail?.models ?? []).map((model) => ({
              key: model.modelName,
              title: model.modelName,
              metric: <>总 {formatCompactNumber(model.totalTokens)}</>,
              subMetric: (
                <>
                  输入 {formatInputWithCache(model.inputTokens, model.cacheTokens)} · 输出 {formatCompactNumber(model.outputTokens)}
                </>
              ),
              meta: `请求 ${model.requestCount.toLocaleString("zh-CN")} · 最近 ${formatDateTime(model.latestUsedAt)}`,
            }))}
          />

          <BreakdownPanel
            loading={detailLoading}
            title="渠道调用排行"
            emptyText="当前筛选条件下没有渠道调用记录"
            rows={(userDetail?.channels ?? []).map((channel) => ({
              key: `${channel.channelId}-${channel.channelName}`,
              title: channel.channelName,
              metric: <>总 {formatCompactNumber(channel.totalTokens)}</>,
              subMetric: (
                <>
                  输入 {formatInputWithCache(channel.inputTokens, channel.cacheTokens)} · 输出 {formatCompactNumber(channel.outputTokens)}
                </>
              ),
              meta: `请求 ${channel.requestCount.toLocaleString("zh-CN")} · 最近 ${formatDateTime(channel.latestUsedAt)}`,
            }))}
          />
        </div>

        <div className="ds-dialog-grid px-4 py-4 sm:px-6 sm:py-6 md:grid-cols-2">
          <DataCard label="活跃模型数" value={detailLoading ? <InlineSkeleton /> : (userDetail?.activeModelCount ?? 0).toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的模型" />
          <DataCard label="活跃渠道数" value={detailLoading ? <InlineSkeleton /> : (userDetail?.activeChannelCount ?? 0).toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的渠道" />
        </div>
      </div>
    </div>
  );
}

export function useUserDetailDialog() {
  const [selectedRow, setSelectedRow] = useState<UserRankingRow | null>(null);

  return {
    selectedRow,
    openRow: (row: UserRankingRow) => setSelectedRow(row),
    closeRow: () => setSelectedRow(null),
    isOpen: selectedRow !== null,
  };
}
