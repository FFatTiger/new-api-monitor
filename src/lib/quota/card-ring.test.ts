import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getWeeklyQuotaRingData } from "./card-ring.ts";

import type { QuotaData } from "@/types/quota";

describe("weekly quota ring data", () => {
  it("prefers the Codex weekly window and converts used percent to remaining progress", () => {
    const data: QuotaData = {
      windows: [
        { id: "codex-five-hour", label: "5小时", usedPercent: 80 },
        { id: "codex-weekly", label: "周窗口", usedPercent: 35 },
      ],
    };

    assert.deepEqual(getWeeklyQuotaRingData("codex", data), {
      percent: 65,
      label: "周额度",
      valueLabel: "65%",
      tone: "emerald",
    });
  });

  it("falls back to the secondary Codex rate-limit window", () => {
    const data: QuotaData = {
      rateLimit: {
        primaryWindow: { usedPercent: 10 },
        secondaryWindow: { usedPercent: 82 },
      },
    };

    assert.deepEqual(getWeeklyQuotaRingData("codex", data), {
      percent: 18,
      label: "周额度",
      valueLabel: "18%",
      tone: "red",
    });
  });

  it("returns an empty weekly ring when weekly progress is unavailable", () => {
    assert.deepEqual(getWeeklyQuotaRingData("gemini-cli", {}), {
      percent: null,
      label: "周额度",
      valueLabel: "--",
      tone: "muted",
    });
  });

  it("shows the MiniMax current window when no weekly quota is returned", () => {
    const data: QuotaData = {
      windows: [{ id: "minimax-hour", label: "4小时额度", remainingPercent: 99.7, valueLabel: "99.7/100P" }],
    };

    assert.deepEqual(getWeeklyQuotaRingData("minimax", data), {
      percent: 100,
      label: "4小时额度",
      valueLabel: "100%",
      tone: "emerald",
    });
  });

  it("prefers the MiniMax weekly window when available", () => {
    const data: QuotaData = {
      windows: [
        { id: "minimax-hour", label: "4小时额度", remainingPercent: 75 },
        { id: "minimax-week", label: "周额度", remainingPercent: 40 },
      ],
    };

    assert.deepEqual(getWeeklyQuotaRingData("minimax", data), {
      percent: 40,
      label: "周额度",
      valueLabel: "40%",
      tone: "amber",
    });
  });

  it("uses the Z.ai tokens limit as the top-right quota summary", () => {
    const data: QuotaData = {
      windows: [
        { id: "time-limit", label: "Time", remainingPercent: 90 },
        { id: "tokens-limit", label: "Tokens", remainingPercent: 24.7 },
      ],
    };

    assert.deepEqual(getWeeklyQuotaRingData("zai", data), {
      percent: 25,
      label: "Tokens",
      valueLabel: "25%",
      tone: "amber",
    });
  });
});
