"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { formatCompactNumber, formatDateTime, formatInputWithCache, formatStatus } from "@/lib/format";
import type { TokenDetailData, TokenRankingRow } from "@/lib/queries/dashboard";

interface TokenDetailDialogProps {
  row: TokenRankingRow | null;
  open: boolean;
  onClose: () => void;
}

export function TokenDetailDialog({ row, open, onClose }: TokenDetailDialogProps) {
  const searchParams = useSearchParams();
  const [detailResult, setDetailResult] = useState<{ url: string; detail: TokenDetailData | null; error: string | null } | null>(null);

  const detailUrl = useMemo(() => {
    if (!row) return null;

    const params = new URLSearchParams(searchParams.toString());
    params.set("tokenId", String(row.tokenId));
    params.set("tokenName", row.tokenName);
    return `/api/token-detail?${params.toString()}`;
  }, [row, searchParams]);

  useEffect(() => {
    if (!open || !detailUrl) {
      return;
    }

    const controller = new AbortController();

    fetch(detailUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("详情加载失败");
        return (await response.json()) as { detail?: TokenDetailData };
      })
      .then((payload) => setDetailResult({ url: detailUrl, detail: payload.detail ?? null, error: null }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailResult({ url: detailUrl, detail: null, error: error instanceof Error ? error.message : String(error) });
      });

    return () => controller.abort();
  }, [detailUrl, open, row?.detail]);
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

  if (!open || !row) {
    return null;
  }

  const currentDetailResult = detailResult?.url === detailUrl ? detailResult : null;
  const tokenDetail = currentDetailResult?.detail ?? row.detail ?? null;
  const detailError = currentDetailResult?.error ?? null;
  const detailLoading = !tokenDetail && !detailError;
  const averageInputTokens = row.requestCount > 0 ? row.inputTokens / row.requestCount : 0;
  const averageOutputTokens = row.requestCount > 0 ? row.outputTokens / row.requestCount : 0;
  const averageTotalTokens = row.requestCount > 0 ? row.totalTokens / row.requestCount : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5">
      <div className="ds-overlay-panel absolute inset-0" onClick={onClose} />
      <div className="ds-overlay-card relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-[26px] sm:max-h-[90vh] sm:max-w-6xl sm:rounded-[28px]">
        <div className="ds-divider px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="ds-kicker">密钥详情</p>
              <h3 className="mt-3 break-words text-[1.18rem] font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-[1.45rem]">
                {row.tokenName}
              </h3>
              <p className="mt-2 ds-mono text-[0.74rem] uppercase tracking-[0.08em] text-[var(--foreground-faint)]">
                编号 {row.tokenId}
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
          <DataCard label="用户名" value={row.username} subValue={row.displayName || "-"} />
          <DataCard label="状态" value={formatStatus(row.status)} subValue={`最近调用 ${formatDateTime(row.latestUsedAt)}`} />
          <DataCard label="请求数" value={row.requestCount.toLocaleString("zh-CN")} subValue="当前筛选窗口内" />
          <DataCard label="输入令牌" value={formatInputWithCache(row.inputTokens, row.cacheTokens)} subValue="当前筛选窗口内累计" />
          <DataCard label="输出令牌" value={formatCompactNumber(row.outputTokens)} subValue="当前筛选窗口内累计" />
          <DataCard label="总令牌" value={formatCompactNumber(row.totalTokens)} subValue="当前筛选窗口内累计" />
        </div>

        <div className="ds-divider ds-dialog-grid px-4 py-4 sm:px-6 sm:py-6 md:grid-cols-2 xl:grid-cols-5">
          <DataCard label="首次调用" value={detailLoading ? <InlineSkeleton /> : formatDateTime(tokenDetail?.firstUsedAt ?? 0)} subValue="当前筛选窗口内首次记录" />
          <DataCard label="过期时间" value={formatDateTime(row.expiredTime)} subValue={row.expiredTime < 0 ? "未设置" : "北京时间"} />
          <DataCard label="平均输入 / 请求" value={formatCompactNumber(averageInputTokens)} subValue="当前筛选窗口内" />
          <DataCard label="平均输出 / 请求" value={formatCompactNumber(averageOutputTokens)} subValue="当前筛选窗口内" />
          <DataCard label="平均总令牌 / 请求" value={formatCompactNumber(averageTotalTokens)} subValue="当前筛选窗口内" />
        </div>

        {detailError ? <p className="px-4 py-3 text-sm text-red-500 sm:px-6">{detailError}</p> : null}

        <div className="ds-divider grid gap-4 px-4 py-4 sm:px-6 sm:py-6 xl:grid-cols-2">
          <BreakdownPanel
            loading={detailLoading}
            title="模型调用排行"
            emptyText="当前筛选条件下没有模型调用记录"
            rows={(tokenDetail?.models ?? []).map((model) => ({
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
            rows={(tokenDetail?.channels ?? []).map((channel) => ({
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
          <DataCard label="活跃模型数" value={detailLoading ? <InlineSkeleton /> : (tokenDetail?.activeModelCount ?? 0).toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的模型" />
          <DataCard label="活跃渠道数" value={detailLoading ? <InlineSkeleton /> : (tokenDetail?.activeChannelCount ?? 0).toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的渠道" />
        </div>
      </div>
    </div>
  );
}

interface DataCardProps {
  label: string;
  value: ReactNode;
  subValue: string;
}

function InlineSkeleton() {
  return <span className="inline-block h-4 w-24 rounded-full align-middle ds-skeleton" />;
}

function DataCard({ label, value, subValue }: DataCardProps) {
  return (
    <article className="ds-card-muted px-4 py-3.5">
      <p className="ds-kicker text-[0.58rem] text-[var(--foreground-faint)]">{label}</p>
      <p className="mt-3 break-words ds-mono text-[0.92rem] font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-[1rem]">
        {value}
      </p>
      <p className="mt-2 text-[0.72rem] text-[var(--foreground-soft)]">{subValue}</p>
    </article>
  );
}

interface BreakdownPanelProps {
  loading?: boolean;
  title: string;
  emptyText: string;
  rows: Array<{
    key: string;
    title: string;
    metric: ReactNode;
    subMetric: ReactNode;
    meta: string;
  }>;
}

function BreakdownPanel({ loading = false, title, emptyText, rows }: BreakdownPanelProps) {
  return (
    <section className="ds-card px-4 py-4 sm:px-5 sm:py-5">
      <div className="ds-divider mb-4 flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-[0.92rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">{title}</h4>
        <span className="ds-kicker text-[0.56rem] text-[var(--foreground-faint)]">按总令牌排序</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <article key={index} className="ds-card-muted px-4 py-3.5">
              <div className="ds-skeleton h-4 w-36 rounded-full" />
              <div className="mt-3 ds-skeleton h-4 w-24 rounded-full" />
              <div className="mt-3 ds-skeleton h-3 w-48 rounded-full" />
            </article>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--foreground-soft)]">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <article key={row.key} className="ds-card-muted ds-card-interactive px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="ds-table-rank">#{String(index + 1).padStart(2, "0")}</p>
                  <h5 className="mt-2 break-words text-[0.88rem] font-semibold text-[var(--foreground)]">{row.title}</h5>
                </div>
                <div className="shrink-0 text-right">
                  <p className="ds-mono text-[0.88rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">{row.metric}</p>
                  <p className="mt-1 text-[0.68rem] text-[var(--foreground-soft)]">{row.subMetric}</p>
                </div>
              </div>
              <p className="mt-3 text-[0.72rem] text-[var(--foreground-soft)]">{row.meta}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function useTokenDetailDialog() {
  const [selectedRow, setSelectedRow] = useState<TokenRankingRow | null>(null);

  return {
    selectedRow,
    openRow: (row: TokenRankingRow) => setSelectedRow(row),
    closeRow: () => setSelectedRow(null),
    isOpen: selectedRow !== null,
  };
}
