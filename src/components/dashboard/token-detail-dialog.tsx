"use client";

import { useEffect, useState } from "react";

import { formatCompactNumber, formatDateTime, formatQuota, formatStatus } from "@/lib/format";
import type { TokenRankingRow } from "@/lib/queries/dashboard";

interface TokenDetailDialogProps {
  row: TokenRankingRow | null;
  open: boolean;
  onClose: () => void;
}

export function TokenDetailDialog({ row, open, onClose }: TokenDetailDialogProps) {
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

  const isUnlimited = row.unlimitedQuota;
  const remainLabel = isUnlimited ? "不限额" : formatQuota(Math.abs(row.remainQuota));
  const usedLabel = formatQuota(Math.abs(row.usedQuota));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/72 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-[1.35rem] border border-[#273140] bg-[linear-gradient(180deg,rgba(6,10,15,0.985),rgba(8,13,20,0.985))] shadow-[0_50px_180px_rgba(0,0,0,0.55)] sm:max-h-[90vh] sm:max-w-6xl sm:rounded-[1.6rem]">
        <div className="border-b border-white/6 px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.58rem] uppercase tracking-[0.22em] text-slate-500 sm:text-[0.62rem] sm:tracking-[0.3em]">
                密钥详情
              </p>
              <h3 className="mt-2 break-words text-lg font-semibold text-white sm:text-xl">{row.tokenName}</h3>
              <p className="mt-2 [font-family:var(--font-code)] text-[0.68rem] uppercase tracking-[0.16em] text-slate-500 sm:text-[0.72rem] sm:tracking-[0.18em]">
                编号 {row.tokenId}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border border-white/8 bg-white/[0.03] text-slate-300 transition hover:border-white/18 hover:bg-white/[0.06]"
              aria-label="关闭详情弹窗"
            >
              ×
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-4">
          <DataCard label="用户名" value={row.username} subValue={row.displayName || "-"} />
          <DataCard label="状态" value={formatStatus(row.status)} subValue={`最近调用 ${formatDateTime(row.latestUsedAt)}`} />
          <DataCard label="请求数" value={row.requestCount.toLocaleString("zh-CN")} subValue="当前筛选窗口内" />
          <DataCard label="令牌消耗" value={formatCompactNumber(row.totalTokens)} subValue={`配额 ${formatQuota(row.totalQuota)}`} />
        </div>

        <div className="grid gap-3 border-t border-white/6 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-4">
          <DataCard label="剩余额度" value={remainLabel} subValue={isUnlimited ? "该密钥不限额" : "来自 tokens.remain_quota"} />
          <DataCard label="已用额度" value={usedLabel} subValue="来自 tokens.used_quota" />
          <DataCard label="首次调用" value={formatDateTime(row.detail.firstUsedAt)} subValue="当前筛选窗口内首次记录" />
          <DataCard label="过期时间" value={formatDateTime(row.expiredTime)} subValue={row.expiredTime < 0 ? "未设置" : "北京时间"} />
        </div>

        <div className="grid gap-4 border-t border-white/6 p-4 sm:p-5 xl:grid-cols-[1.3fr_1fr]">
          <BreakdownPanel
            title="模型调用排行"
            emptyText="当前筛选条件下没有模型调用记录"
            rows={row.detail.models.map((model) => ({
              key: model.modelName,
              title: model.modelName,
              metric: formatCompactNumber(model.totalTokens),
              meta: `请求 ${model.requestCount.toLocaleString("zh-CN")} · 配额 ${formatQuota(model.totalQuota)} · 最近 ${formatDateTime(model.latestUsedAt)}`,
            }))}
          />

          <BreakdownPanel
            title="渠道调用排行"
            emptyText="当前筛选条件下没有渠道调用记录"
            rows={row.detail.channels.map((channel) => ({
              key: `${channel.channelId}-${channel.channelName}`,
              title: channel.channelName,
              metric: formatCompactNumber(channel.totalTokens),
              meta: `请求 ${channel.requestCount.toLocaleString("zh-CN")} · 配额 ${formatQuota(channel.totalQuota)} · 最近 ${formatDateTime(channel.latestUsedAt)}`,
            }))}
          />
        </div>

        <div className="grid gap-3 border-t border-white/6 p-4 sm:p-5 md:grid-cols-3">
          <DataCard label="活跃模型数" value={row.detail.activeModelCount.toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的模型" />
          <DataCard label="活跃渠道数" value={row.detail.activeChannelCount.toLocaleString("zh-CN")} subValue="当前筛选窗口内命中的渠道" />
          <DataCard label="平均每次消耗" value={formatCompactNumber(row.requestCount > 0 ? row.totalTokens / row.requestCount : 0)} subValue="令牌 / 请求" />
        </div>
      </div>
    </div>
  );
}

interface DataCardProps {
  label: string;
  value: string;
  subValue: string;
}

function DataCard({ label, value, subValue }: DataCardProps) {
  return (
    <article className="rounded-[0.95rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-3 py-3 sm:rounded-[1rem] sm:px-4">
      <p className="text-[0.56rem] uppercase tracking-[0.18em] text-slate-500 sm:text-[0.6rem] sm:tracking-[0.22em]">{label}</p>
      <p className="mt-3 break-words [font-family:var(--font-code)] text-[0.94rem] font-semibold text-white sm:text-[1.02rem]">
        {value}
      </p>
      <p className="mt-2 text-[0.7rem] text-slate-500 sm:text-[0.72rem]">{subValue}</p>
    </article>
  );
}

interface BreakdownPanelProps {
  title: string;
  emptyText: string;
  rows: Array<{
    key: string;
    title: string;
    metric: string;
    meta: string;
  }>;
}

function BreakdownPanel({ title, emptyText, rows }: BreakdownPanelProps) {
  return (
    <section className="rounded-[1rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-3 sm:rounded-[1.1rem] sm:p-4">
      <div className="mb-3 flex flex-col gap-2 border-b border-white/6 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-[0.68rem] uppercase tracking-[0.18em] text-slate-300 sm:text-[0.74rem] sm:tracking-[0.24em]">{title}</h4>
        <span className="text-[0.58rem] uppercase tracking-[0.16em] text-slate-500 sm:text-[0.62rem] sm:tracking-[0.2em]">按令牌消耗排序</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, index) => (
            <article
              key={row.key}
              className="rounded-[0.9rem] border border-white/6 bg-black/20 px-3 py-3 transition hover:border-cyan-300/18 hover:bg-cyan-300/[0.04] sm:rounded-[0.95rem]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="[font-family:var(--font-code)] text-[0.58rem] uppercase tracking-[0.14em] text-slate-600 sm:text-[0.62rem] sm:tracking-[0.18em]">
                    #{String(index + 1).padStart(2, "0")}
                  </p>
                  <h5 className="mt-2 break-words text-sm font-semibold text-white">{row.title}</h5>
                </div>
                <p className="shrink-0 [font-family:var(--font-code)] text-[0.86rem] font-semibold text-cyan-300 sm:text-[0.92rem]">{row.metric}</p>
              </div>
              <p className="mt-3 text-[0.7rem] text-slate-500 sm:text-[0.72rem]">{row.meta}</p>
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
