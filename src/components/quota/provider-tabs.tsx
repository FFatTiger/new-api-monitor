"use client";

import type { ProviderFilter } from "@/types/quota";

type ProviderTab = {
  key: ProviderFilter;
  label: string;
};

type ProviderTabsProps = {
  tabs: ProviderTab[];
  selected: ProviderFilter;
  counts: Record<ProviderFilter, number>;
  onSelect: (value: ProviderFilter) => void;
};

export function ProviderTabs({ tabs, selected, counts, onSelect }: ProviderTabsProps) {
  return (
    <div className="overflow-x-auto">
      <div className="ds-pill min-w-max p-1">
        {tabs.map((tab) => {
          const active = selected === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelect(tab.key)}
              className={[
                "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[0.78rem] font-medium transition-colors duration-150",
                active
                  ? "bg-[var(--background-elevated)] ds-tab-active-text shadow-[0_0_0_1px_var(--surface-ring-soft)]"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              <span>{tab.label}</span>
              <span className="ds-mono text-[0.72rem] text-[var(--foreground-faint)]">{counts[tab.key] || 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
