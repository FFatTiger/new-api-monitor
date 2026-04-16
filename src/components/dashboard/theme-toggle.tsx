"use client";

import { useSyncExternalStore } from "react";

type ThemePreference = "light" | "dark";

const storageKey = "theme-preference";
const themeChangeEvent = "theme-preference-change";

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

function getThemePreference(): ThemePreference {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === null || event.key === storageKey) {
      callback();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(themeChangeEvent, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(themeChangeEvent, callback);
  };
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
  window.localStorage.setItem(storageKey, preference);
  window.dispatchEvent(new Event(themeChangeEvent));
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, getThemePreference, () => "light");

  function handleChange(nextPreference: ThemePreference) {
    applyTheme(nextPreference);
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="theme-preference">
        主题
      </label>
      <select
        id="theme-preference"
        value={preference}
        onChange={(event) => handleChange(event.target.value as ThemePreference)}
        className="ds-compact-control h-10 min-w-[92px] appearance-none pr-8"
        aria-label="切换主题"
        suppressHydrationWarning
      >
        {themeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
