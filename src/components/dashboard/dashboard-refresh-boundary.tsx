"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export const DASHBOARD_REFRESH_EVENT = "dashboard:refresh-start";

interface DashboardRefreshBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

export function announceDashboardRefresh() {
  window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
}

export function DashboardRefreshBoundary({ children, fallback }: DashboardRefreshBoundaryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationKey = `${pathname}?${searchParams.toString()}`;
  const [refreshingLocationKey, setRefreshingLocationKey] = useState<string | null>(null);
  const refreshing = refreshingLocationKey === locationKey;

  useEffect(() => {
    const handleRefreshStart = () => setRefreshingLocationKey(locationKey);

    window.addEventListener(DASHBOARD_REFRESH_EVENT, handleRefreshStart);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, handleRefreshStart);
  }, [locationKey]);

  return refreshing ? fallback : children;
}
