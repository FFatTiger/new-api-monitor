"use client";

import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { TopTabs } from "@/components/navigation/top-tabs";

type AppHeaderProps = {
  timestamp?: string;
  controls?: ReactNode;
  title?: string;
  subtitle?: string;
};

export function AppHeader({
  timestamp,
  controls,
  title = "NEW-API-MONITOR",
  subtitle = "监控与账号配额视图",
}: AppHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div>
            <h1 className="ds-wordmark">{title}</h1>
            <p className="mt-2 text-[0.9rem] text-[var(--foreground-soft)]">{subtitle}</p>
          </div>
          <TopTabs />
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          {timestamp ? (
            <div className="rounded-[12px] bg-[var(--background-elevated)] px-3 py-2 shadow-[0_0_0_1px_var(--surface-ring)]">
              <p className="ds-mono text-[0.8rem] text-[var(--foreground-muted)] sm:text-[0.84rem]">{timestamp}</p>
            </div>
          ) : null}
          <ThemeToggle />
          {controls}
        </div>
      </div>
    </header>
  );
}
