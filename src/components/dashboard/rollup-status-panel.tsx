import type { DashboardRollupReadiness } from "@/lib/dashboard/types";

export interface DashboardRollupStatusPanelProps {
  title?: string;
  message?: string;
  processedRows?: number;
  readiness?: DashboardRollupReadiness;
}

export function DashboardRollupStatusPanel({
  title = "长期统计暂不可用",
  message,
  processedRows,
  readiness,
}: DashboardRollupStatusPanelProps) {
  if (readiness?.kind === "ready") {
    return null;
  }

  const resolvedMessage =
    message ??
    readiness?.safeMessage ??
    "长期统计暂时不可用，请稍后重试。";
  const resolvedRows = processedRows ?? readiness?.processedRows;

  const processedLabel = readiness ? "已永久处理" : "已同步处理";

  return (
    <section className="ds-panel px-4 py-5 sm:px-5 sm:py-6">
      <p className="ds-kicker">状态</p>
      <h2 className="mt-3 text-[1.16rem] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)] sm:text-[1.35rem]">
        {title}
      </h2>
      <p className="mt-4 whitespace-pre-line text-sm leading-6 text-[var(--foreground-soft)]">
        {resolvedMessage}
      </p>
      {resolvedRows !== undefined ? (
        <p className="mt-4 text-xs text-[var(--foreground-faint)]">
          {processedLabel} {resolvedRows.toLocaleString("zh-CN")} 条日志。
        </p>
      ) : null}
    </section>
  );
}
