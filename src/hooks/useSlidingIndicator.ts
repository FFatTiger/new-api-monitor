"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Positions a sliding "active pill" behind the active item of a tab bar.
 *
 * Usage:
 * - `containerRef` → the tab bar element (needs `position: relative`)
 * - each tab item renders `data-tab-key={key}` (the same key passed as
 *   `activeKey`)
 * - `state` → `{ left, width, animate }` for an absolutely-positioned
 *   indicator; only attach the CSS transition when `animate` is true so the
 *   first paint is silent
 *
 * Position is persisted per `storeKey` at module scope: top-level nav bars
 * remount on every route change, so keeping the last measured position lets
 * the pill slide from the previously active tab instead of snapping.
 */
export function useSlidingIndicator(activeKey: string, storeKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState(() => {
    const prev = persisted.get(storeKey);
    return { left: prev?.left ?? 0, width: prev?.width ?? 0, animate: false };
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const item = container.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(activeKey)}"]`);
    if (!item) return;

    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      return { left: itemRect.left - containerRect.left, width: itemRect.width };
    };

    const prev = persisted.get(storeKey);
    const next = measure();
    setState({ ...next, animate: prev?.hasMeasured === true });
    persisted.set(storeKey, { ...next, hasMeasured: true });

    // Reposition silently on real container size changes (window resize, font
    // load, responsive breakpoint). A measurement that yields the same
    // position — e.g. ResizeObserver's initial notification right after
    // observe() — must NOT touch the animate flag, or it would cancel an
    // in-flight tab slide.
    const reposition = () => {
      const current = measure();
      setState((prev) => {
        if (prev.left === current.left && prev.width === current.width) {
          return prev;
        }
        return { ...current, animate: false };
      });
      persisted.set(storeKey, { ...current, hasMeasured: true });
    };
    const observer = new ResizeObserver(reposition);
    observer.observe(container);
    window.addEventListener("resize", reposition);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [activeKey, storeKey]);

  return { containerRef, state };
}

interface PersistedPosition {
  left: number;
  width: number;
  hasMeasured: boolean;
}

const persisted = new Map<string, PersistedPosition>();
