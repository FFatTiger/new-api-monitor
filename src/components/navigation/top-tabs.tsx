"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSlidingIndicator } from "@/hooks/useSlidingIndicator";

const tabs = [
  { href: "/", label: "监控概览" },
  { href: "/quota", label: "账号 Quota" },
  { href: "/subscriptions", label: "订阅" },
  { href: "/oauth", label: "OAuth 登录" },
];

export function TopTabs() {
  const pathname = usePathname();
  const activeKey = tabs.find((tab) => (tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)))?.href ?? "/";
  const { containerRef, state } = useSlidingIndicator(activeKey, "top-tabs");

  return (
    <nav ref={containerRef} className="ds-pill relative w-fit p-1" aria-label="主导航">
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute bottom-1 top-1 rounded-full bg-[var(--background-elevated)] shadow-[0_0_0_1px_var(--surface-ring-soft)]",
          state.animate ? "ds-sliding-indicator" : "",
        ].join(" ")}
        style={{ left: state.left, width: state.width }}
      />
      {tabs.map((tab) => {
        const active = tab.href === activeKey;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-tab-key={tab.href}
            className={[
              "relative z-10 rounded-full px-4 py-2 text-[0.8rem] font-medium transition-colors duration-150",
              active
                ? "ds-tab-active-text text-[var(--foreground)]"
                : "text-[var(--foreground-soft)] hover:text-[var(--foreground)]",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
