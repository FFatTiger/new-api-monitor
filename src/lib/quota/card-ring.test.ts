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
});
