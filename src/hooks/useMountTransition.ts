import { useEffect, useState } from "react";

/**
 * Keeps an element mounted while its exit transition plays.
 *
 * - `mounted`: whether the element should be rendered at all
 * - `visible`: drive a `data-state` attribute ("open" / "closed") so CSS
 *   transitions run in both directions
 *
 * When `open` flips to false the element stays mounted for `exitMs`, letting
 * the exit CSS transition finish before unmounting. The closed-pose flips are
 * done as render-time state adjustments (React's documented "adjust state when
 * a prop changes" pattern); only rAF/timeout callbacks write state inside
 * effects, so the enter/exit transitions stay one-shot and never cascade.
 */
export function useMountTransition(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  if (open && !mounted) {
    // Mount at the closed pose so the enter transition plays from a painted state.
    setMounted(true);
  }

  if (!open && mounted && visible) {
    // Drop to the closed pose so the exit transition plays before unmounting.
    setVisible(false);
  }

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  useEffect(() => {
    if (!open && mounted) {
      const timer = window.setTimeout(() => setMounted(false), exitMs);
      return () => window.clearTimeout(timer);
    }
  }, [open, mounted, exitMs]);

  return { mounted, visible };
}
