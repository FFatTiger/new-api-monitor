"use client";

import { useState } from "react";

type ThemePreference = "light" | "dark";

const storageKey = "theme-preference";

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
}

function getInitialPreference(): ThemePreference {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);

  function handleChange(nextPreference: ThemePreference) {
    setPreference(nextPreference);
    applyTheme(nextPreference);
    window.localStorage.setItem(storageKey, nextPreference);
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
