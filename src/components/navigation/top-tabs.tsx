"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "监控概览" },
  { href: "/quota", label: "账号 Quota" },
  { href: "/oauth", label: "OAuth 登录" },
];

export function TopTabs() {
  const pathname = usePathname();

  return (
    <nav className="ds-pill w-fit p-1" aria-label="主导航">
      {tabs.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "rounded-full px-4 py-2 text-[0.8rem] font-medium transition-colors duration-150",
              active
                ? "bg-[var(--background-elevated)] ds-tab-active-text shadow-[0_0_0_1px_var(--surface-ring-soft)]"
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
