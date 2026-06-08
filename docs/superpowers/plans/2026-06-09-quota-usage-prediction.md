# Quota Usage Prediction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provider-level quota usage prediction panel driven by compose-configured channel groups, quota snapshots, and selectable recent usage windows.

**Architecture:** Add focused server-side helpers for config parsing, quota aggregation, snapshot persistence, and prediction queries. Add two App Router route handlers: one records provider quota snapshots after quota refresh, one returns prediction rows for the selected speed window. The existing quota client fetches predictions and renders a compact panel above the card grid.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, TypeScript, PostgreSQL via `pg`, Node built-in test runner with `--experimental-strip-types`.

---

## File Map

- Create `src/lib/quota/usage-config.ts`: parse `QUOTA_USAGE_GROUPS`, normalize speed windows, expose defaults.
- Create `src/lib/quota/usage-config.test.ts`: TDD coverage for group parsing and speed window normalization.
- Create `src/lib/quota/usage-aggregation.ts`: select provider-level quota window and aggregate multiple quota cards into a provider snapshot candidate.
- Create `src/lib/quota/usage-aggregation.test.ts`: TDD coverage for provider window selection and provider aggregation.
- Create `src/lib/queries/quota-usage-prediction.ts`: ensure snapshot table, record snapshots, query usage and prediction rows.
- Create `src/lib/queries/quota-usage-prediction.test.ts`: TDD coverage for pure prediction math and snapshot write policy helpers.
- Create `src/app/api/quota-usage-snapshots/route.ts`: POST route that records provider snapshots.
- Create `src/app/api/quota-usage-prediction/route.ts`: GET route that returns prediction rows for `windowMinutes`.
- Create `src/components/quota/quota-prediction-panel.tsx`: render provider prediction rows and speed window selector.
- Modify `src/types/quota.ts`: add prediction-related types.
- Modify `src/hooks/useQuota.ts`: record snapshots after successful quota refresh and fetch predictions when quota/window changes.
- Modify `src/components/quota/quota-page-client.tsx`: own selected speed window, render prediction panel, pass provider filter.
- Modify `docker-compose.portainer.yml`: add `QUOTA_USAGE_GROUPS` mapping.
- Modify `.env.example`: add local `QUOTA_USAGE_GROUPS` example.

---

## Task 1: Config Parser and Speed Windows

**Files:**
- Create: `src/lib/quota/usage-config.ts`
- Test: `src/lib/quota/usage-config.test.ts`

- [ ] **Step 1: Write failing tests for config parsing and speed windows**

Create `src/lib/quota/usage-config.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_QUOTA_USAGE_WINDOW_MINUTES,
  parseQuotaUsageGroups,
  QUOTA_USAGE_WINDOW_OPTIONS,
  normalizeQuotaUsageWindowMinutes,
} from "./usage-config.ts";

describe("quota usage config", () => {
  it("parses provider channel groups from semicolon config", () => {
    assert.deepEqual(parseQuotaUsageGroups("codex=8,17,19; claude=12 ;zai=27;bad;minimax=x,24"), {
      codex: [8, 17, 19],
      claude: [12],
      zai: [27],
      minimax: [24],
    });
  });

  it("deduplicates channels and ignores invalid provider keys", () => {
    assert.deepEqual(parseQuotaUsageGroups("codex=8,8,0,-1;unknown=1;gemini-cli=44"), {
      codex: [8],
      "gemini-cli": [44],
    });
  });

  it("normalizes window minutes to supported values", () => {
    assert.equal(DEFAULT_QUOTA_USAGE_WINDOW_MINUTES, 720);
    assert.deepEqual(QUOTA_USAGE_WINDOW_OPTIONS.map((option) => option.minutes), [60, 180, 360, 720, 1440]);
    assert.equal(normalizeQuotaUsageWindowMinutes("60"), 60);
    assert.equal(normalizeQuotaUsageWindowMinutes("180"), 180);
    assert.equal(normalizeQuotaUsageWindowMinutes("360"), 360);
    assert.equal(normalizeQuotaUsageWindowMinutes("720"), 720);
    assert.equal(normalizeQuotaUsageWindowMinutes("1440"), 1440);
    assert.equal(normalizeQuotaUsageWindowMinutes("15"), 720);
    assert.equal(normalizeQuotaUsageWindowMinutes(undefined), 720);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/lib/quota/usage-config.test.ts
```

Expected: FAIL because `src/lib/quota/usage-config.ts` does not exist.

- [ ] **Step 3: Implement config parser**

Create `src/lib/quota/usage-config.ts`:

```ts
import type { ProviderType } from "@/types/quota";

export type QuotaUsageGroupMap = Partial<Record<ProviderType, number[]>>;

export const DEFAULT_QUOTA_USAGE_WINDOW_MINUTES = 720;

export const QUOTA_USAGE_WINDOW_OPTIONS = [
  { minutes: 60, label: "60 分钟" },
  { minutes: 180, label: "3 小时" },
  { minutes: 360, label: "6 小时" },
  { minutes: 720, label: "12 小时" },
  { minutes: 1440, label: "1 天" },
] as const;

const validProviders = new Set<ProviderType>([
  "antigravity",
  "claude",
  "codex",
  "gemini-cli",
  "kimi",
  "minimax",
  "xai",
  "zai",
]);

export function normalizeQuotaUsageWindowMinutes(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return QUOTA_USAGE_WINDOW_OPTIONS.some((option) => option.minutes === numeric)
    ? numeric
    : DEFAULT_QUOTA_USAGE_WINDOW_MINUTES;
}

export function parseQuotaUsageGroups(value: unknown): QuotaUsageGroupMap {
  if (typeof value !== "string" || !value.trim()) return {};

  const groups: QuotaUsageGroupMap = {};
  value.split(";").forEach((entry) => {
    const [rawProvider, rawChannels] = entry.split("=");
    const provider = rawProvider?.trim().toLowerCase() as ProviderType;
    if (!validProviders.has(provider) || !rawChannels) return;

    const channels = Array.from(
      new Set(
        rawChannels
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((channelId) => Number.isInteger(channelId) && channelId > 0),
      ),
    );

    if (channels.length > 0) {
      groups[provider] = channels;
    }
  });

  return groups;
}

export function getQuotaUsageGroupsFromEnv() {
  return parseQuotaUsageGroups(process.env.QUOTA_USAGE_GROUPS || process.env.NEW_API_MONITOR_QUOTA_USAGE_GROUPS || "");
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/lib/quota/usage-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quota/usage-config.ts src/lib/quota/usage-config.test.ts
git commit -m "feat: add quota usage config parser"
```

---

## Task 2: Provider Quota Aggregation

**Files:**
- Create: `src/lib/quota/usage-aggregation.ts`
- Test: `src/lib/quota/usage-aggregation.test.ts`

- [ ] **Step 1: Write failing tests for provider snapshot aggregation**

Create `src/lib/quota/usage-aggregation.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateProviderQuotaSnapshot, getQuotaWindowSnapshot } from "./usage-aggregation.ts";
import type { QuotaData } from "@/types/quota";

describe("quota usage aggregation", () => {
  it("selects a weekly Codex window with remaining percent and reset time", () => {
    const data: QuotaData = {
      windows: [
        { id: "codex-five-hour", label: "5小时", remainingPercent: 80, resetTime: "soon" },
        { id: "codex-weekly", label: "周窗口", remainingPercent: 35, resetTime: "week-reset" },
      ],
    };

    assert.deepEqual(getQuotaWindowSnapshot("codex", data), {
      remainingPercent: 35,
      usedPercent: 65,
      resetTime: "week-reset",
    });
  });

  it("aggregates multiple cards by the lowest remaining percent", () => {
    const snapshot = aggregateProviderQuotaSnapshot("codex", [
      { windows: [{ id: "codex-weekly", remainingPercent: 70, resetTime: "same" }] },
      { windows: [{ id: "codex-weekly", remainingPercent: 20, resetTime: "same" }] },
    ]);

    assert.deepEqual(snapshot, {
      provider: "codex",
      remainingPercent: 20,
      usedPercent: 80,
      resetTime: "same",
    });
  });

  it("falls back to remaining percent derived from used percent", () => {
    const snapshot = getQuotaWindowSnapshot("zai", {
      windows: [{ id: "tokens-limit", usedPercent: 42, resetTime: 123 }],
    });

    assert.deepEqual(snapshot, {
      remainingPercent: 58,
      usedPercent: 42,
      resetTime: 123,
    });
  });

  it("returns null when no usable quota percentage exists", () => {
    assert.equal(aggregateProviderQuotaSnapshot("codex", [{ windows: [{ id: "codex-weekly" }] }]), null);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/lib/quota/usage-aggregation.test.ts
```

Expected: FAIL because `usage-aggregation.ts` does not exist.

- [ ] **Step 3: Implement aggregation helpers**

Create `src/lib/quota/usage-aggregation.ts`:

```ts
import type { ProviderType, QuotaData, RateLimitWindow } from "@/types/quota";

export type ProviderQuotaSnapshotInput = {
  provider: ProviderType;
  remainingPercent: number;
  usedPercent: number;
  resetTime: string | number | null;
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return clampPercent(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampPercent(parsed) : null;
  }
  return null;
}

function getRemainingPercent(windowData: RateLimitWindow) {
  const explicit = normalizePercent(windowData.remainingPercent ?? windowData.remaining_percent);
  if (explicit !== null) return explicit;

  const used = normalizePercent(windowData.usedPercent ?? windowData.used_percent);
  return used === null ? null : clampPercent(100 - used);
}

function isWeeklyWindow(windowData: RateLimitWindow) {
  const id = String(windowData.id || "").toLowerCase();
  const label = String(windowData.label || "").toLowerCase();
  return id.includes("weekly") || id.includes("week") || label.includes("周") || label.includes("week");
}

function pickWindow(provider: ProviderType, windows: RateLimitWindow[]) {
  if (!windows.length) return null;

  if (provider === "codex" || provider === "claude") {
    return windows.find(isWeeklyWindow) || windows[1] || windows[0];
  }

  if (provider === "zai") {
    return windows.find((windowData) => String(windowData.id || "").toLowerCase() === "tokens-limit") || windows.find(isWeeklyWindow) || windows[0];
  }

  if (provider === "minimax") {
    return windows.find(isWeeklyWindow) || windows[0];
  }

  return windows.find(isWeeklyWindow) || windows[0];
}

export function getQuotaWindowSnapshot(provider: ProviderType, data: QuotaData): Omit<ProviderQuotaSnapshotInput, "provider"> | null {
  const windowData = pickWindow(provider, data.windows || []);
  if (!windowData) return null;

  const remainingPercent = getRemainingPercent(windowData);
  if (remainingPercent === null) return null;

  const explicitUsed = normalizePercent(windowData.usedPercent ?? windowData.used_percent);
  const usedPercent = explicitUsed === null ? clampPercent(100 - remainingPercent) : explicitUsed;
  const resetTime = windowData.resetTime ?? windowData.reset_time ?? windowData.reset_at ?? windowData.resetAt ?? null;

  return { remainingPercent, usedPercent, resetTime };
}

export function aggregateProviderQuotaSnapshot(provider: ProviderType, dataItems: QuotaData[]): ProviderQuotaSnapshotInput | null {
  const snapshots = dataItems
    .map((data) => getQuotaWindowSnapshot(provider, data))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));

  if (!snapshots.length) return null;

  const limiting = snapshots.reduce((selected, candidate) =>
    candidate.remainingPercent < selected.remainingPercent ? candidate : selected,
  );

  return { provider, ...limiting };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/lib/quota/usage-aggregation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quota/usage-aggregation.ts src/lib/quota/usage-aggregation.test.ts
git commit -m "feat: aggregate provider quota snapshots"
```

---

## Task 3: Snapshot Persistence and Prediction Math

**Files:**
- Create: `src/lib/queries/quota-usage-prediction.ts`
- Test: `src/lib/queries/quota-usage-prediction.test.ts`
- Modify: `src/types/quota.ts`

- [ ] **Step 1: Write failing tests for pure helpers**

Create `src/lib/queries/quota-usage-prediction.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildQuotaUsagePrediction,
  shouldWriteQuotaSnapshot,
} from "./quota-usage-prediction.ts";

describe("quota usage prediction", () => {
  it("writes first snapshot and throttles unchanged snapshots for five minutes", () => {
    assert.equal(shouldWriteQuotaSnapshot(null, { sampledAt: 1_000, resetTime: "a" }), true);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 900, resetTime: "a" }, { sampledAt: 1_000, resetTime: "a" }), false);
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 699, resetTime: "a" }, { sampledAt: 1_000, resetTime: "a" }), true);
  });

  it("writes immediately when reset time changes", () => {
    assert.equal(shouldWriteQuotaSnapshot({ sampledAt: 990, resetTime: "old" }, { sampledAt: 1_000, resetTime: "new" }), true);
  });

  it("builds an exhaustion estimate from today quota, used percent, and recent speed", () => {
    const row = buildQuotaUsagePrediction({
      provider: "codex",
      channelIds: [8, 17],
      todayGptTokens: 12_000,
      todayQuota: 40_000,
      recentQuota: 20_000,
      windowMinutes: 60,
      latestRemainingPercent: 60,
      latestUsedPercent: 40,
      resetTime: "week",
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "ready");
    assert.equal(row.recentQuotaPerHour, 20_000);
    assert.equal(row.minutesLeft, 180);
    assert.equal(row.exhaustAt, 11_800);
  });

  it("reports no recent usage when speed is zero", () => {
    const row = buildQuotaUsagePrediction({
      provider: "claude",
      channelIds: [12],
      todayGptTokens: 0,
      todayQuota: 0,
      recentQuota: 0,
      windowMinutes: 720,
      latestRemainingPercent: 80,
      latestUsedPercent: 20,
      resetTime: null,
      nowSeconds: 1_000,
    });

    assert.equal(row.status, "no_recent_usage");
    assert.equal(row.minutesLeft, null);
    assert.equal(row.exhaustAt, null);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/lib/queries/quota-usage-prediction.test.ts
```

Expected: FAIL because `quota-usage-prediction.ts` does not exist.

- [ ] **Step 3: Add prediction types**

Append these exports to `src/types/quota.ts`:

```ts
export type QuotaUsagePredictionStatus = "ready" | "unconfigured" | "no_snapshot" | "no_recent_usage" | "exhausted";

export interface QuotaUsagePredictionRow {
  provider: ProviderType;
  channelIds: number[];
  configured: boolean;
  todayGptTokens: number;
  todayQuota: number;
  recentQuota: number;
  recentQuotaPerHour: number | null;
  latestRemainingPercent: number | null;
  latestUsedPercent: number | null;
  resetTime: string | null;
  minutesLeft: number | null;
  exhaustAt: number | null;
  status: QuotaUsagePredictionStatus;
}
```

- [ ] **Step 4: Implement persistence and prediction helpers**

Create `src/lib/queries/quota-usage-prediction.ts` with these functions:

```ts
import { query, withClient } from "@/lib/db";
import { getQuotaUsageGroupsFromEnv, type QuotaUsageGroupMap } from "@/lib/quota/usage-config";
import type { ProviderQuotaSnapshotInput } from "@/lib/quota/usage-aggregation";
import type { ProviderType, QuotaUsagePredictionRow } from "@/types/quota";

const SNAPSHOT_INTERVAL_SECONDS = 5 * 60;
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;

type LatestSnapshot = {
  sampledAt: number;
  resetTime: string | null;
  remainingPercent: number | null;
  usedPercent: number | null;
};

type PredictionInput = {
  provider: ProviderType;
  channelIds: number[];
  todayGptTokens: number;
  todayQuota: number;
  recentQuota: number;
  windowMinutes: number;
  latestRemainingPercent: number | null;
  latestUsedPercent: number | null;
  resetTime: string | null;
  nowSeconds: number;
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const numeric = toNumber(value, NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeResetTime(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function getTodayStartShanghaiSeconds(nowSeconds: number) {
  return Math.floor((nowSeconds + SHANGHAI_OFFSET_SECONDS) / 86_400) * 86_400 - SHANGHAI_OFFSET_SECONDS;
}

function getGptModelSql(expression: string) {
  return `(lower(${expression}) LIKE 'gpt%' OR lower(${expression}) LIKE '%codex%')`;
}

export function shouldWriteQuotaSnapshot(previous: Pick<LatestSnapshot, "sampledAt" | "resetTime"> | null, next: { sampledAt: number; resetTime: string | number | null }) {
  if (!previous) return true;
  const previousReset = normalizeResetTime(previous.resetTime);
  const nextReset = normalizeResetTime(next.resetTime);
  if (previousReset !== nextReset) return true;
  return next.sampledAt - previous.sampledAt >= SNAPSHOT_INTERVAL_SECONDS;
}

export function buildQuotaUsagePrediction(input: PredictionInput): QuotaUsagePredictionRow {
  const recentQuotaPerHour = input.windowMinutes > 0 ? input.recentQuota / (input.windowMinutes / 60) : null;

  if (input.latestRemainingPercent === null || input.latestUsedPercent === null) {
    return {
      provider: input.provider,
      channelIds: input.channelIds,
      configured: true,
      todayGptTokens: input.todayGptTokens,
      todayQuota: input.todayQuota,
      recentQuota: input.recentQuota,
      recentQuotaPerHour,
      latestRemainingPercent: input.latestRemainingPercent,
      latestUsedPercent: input.latestUsedPercent,
      resetTime: input.resetTime,
      minutesLeft: null,
      exhaustAt: null,
      status: "no_snapshot",
    };
  }

  if (input.latestRemainingPercent <= 0) {
    return {
      provider: input.provider,
      channelIds: input.channelIds,
      configured: true,
      todayGptTokens: input.todayGptTokens,
      todayQuota: input.todayQuota,
      recentQuota: input.recentQuota,
      recentQuotaPerHour,
      latestRemainingPercent: input.latestRemainingPercent,
      latestUsedPercent: input.latestUsedPercent,
      resetTime: input.resetTime,
      minutesLeft: 0,
      exhaustAt: input.nowSeconds,
      status: "exhausted",
    };
  }

  const quotaPerMinute = input.windowMinutes > 0 ? input.recentQuota / input.windowMinutes : 0;
  if (quotaPerMinute <= 0) {
    return {
      provider: input.provider,
      channelIds: input.channelIds,
      configured: true,
      todayGptTokens: input.todayGptTokens,
      todayQuota: input.todayQuota,
      recentQuota: input.recentQuota,
      recentQuotaPerHour,
      latestRemainingPercent: input.latestRemainingPercent,
      latestUsedPercent: input.latestUsedPercent,
      resetTime: input.resetTime,
      minutesLeft: null,
      exhaustAt: null,
      status: "no_recent_usage",
    };
  }

  if (input.latestUsedPercent <= 0 || input.todayQuota <= 0) {
    return {
      provider: input.provider,
      channelIds: input.channelIds,
      configured: true,
      todayGptTokens: input.todayGptTokens,
      todayQuota: input.todayQuota,
      recentQuota: input.recentQuota,
      recentQuotaPerHour,
      latestRemainingPercent: input.latestRemainingPercent,
      latestUsedPercent: input.latestUsedPercent,
      resetTime: input.resetTime,
      minutesLeft: null,
      exhaustAt: null,
      status: "no_recent_usage",
    };
  }

  const estimatedTotalQuota = input.todayQuota / (input.latestUsedPercent / 100);
  const remainingQuota = estimatedTotalQuota * (input.latestRemainingPercent / 100);
  const minutesLeft = Math.max(0, Math.round(remainingQuota / quotaPerMinute));

  return {
    provider: input.provider,
    channelIds: input.channelIds,
    configured: true,
    todayGptTokens: input.todayGptTokens,
    todayQuota: input.todayQuota,
    recentQuota: input.recentQuota,
    recentQuotaPerHour,
    latestRemainingPercent: input.latestRemainingPercent,
    latestUsedPercent: input.latestUsedPercent,
    resetTime: input.resetTime,
    minutesLeft,
    exhaustAt: input.nowSeconds + minutesLeft * 60,
    status: "ready",
  };
}

export async function ensureQuotaSnapshotTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      remaining_percent DOUBLE PRECISION,
      used_percent DOUBLE PRECISION,
      reset_time TEXT,
      sampled_at BIGINT NOT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_quota_snapshots_provider_sampled_at ON quota_snapshots (provider, sampled_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_quota_snapshots_sampled_at ON quota_snapshots (sampled_at DESC)`);
}

export async function recordQuotaSnapshots(snapshots: ProviderQuotaSnapshotInput[], nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!snapshots.length) return { inserted: 0 };

  await ensureQuotaSnapshotTable();
  let inserted = 0;

  await withClient(async (client) => {
    for (const snapshot of snapshots) {
      const latestResult = await client.query<{ sampled_at: string | number; reset_time: string | null }>(
        `SELECT sampled_at, reset_time FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
        [snapshot.provider],
      );
      const latest = latestResult.rows[0]
        ? { sampledAt: toNumber(latestResult.rows[0].sampled_at), resetTime: latestResult.rows[0].reset_time }
        : null;

      if (!shouldWriteQuotaSnapshot(latest, { sampledAt: nowSeconds, resetTime: snapshot.resetTime })) continue;

      await client.query(
        `INSERT INTO quota_snapshots (provider, remaining_percent, used_percent, reset_time, sampled_at) VALUES ($1, $2, $3, $4, $5)`,
        [snapshot.provider, snapshot.remainingPercent, snapshot.usedPercent, normalizeResetTime(snapshot.resetTime), nowSeconds],
      );
      inserted += 1;
    }

    await client.query(`DELETE FROM quota_snapshots WHERE sampled_at < $1`, [nowSeconds - SNAPSHOT_RETENTION_SECONDS]);
  });

  return { inserted };
}

export async function getQuotaUsagePredictions(windowMinutes: number, groups: QuotaUsageGroupMap = getQuotaUsageGroupsFromEnv(), nowSeconds = Math.floor(Date.now() / 1000)) {
  await ensureQuotaSnapshotTable();

  const providers = Object.keys(groups) as ProviderType[];
  if (!providers.length) return [] as QuotaUsagePredictionRow[];

  const todayStart = getTodayStartShanghaiSeconds(nowSeconds);
  const recentStart = nowSeconds - windowMinutes * 60;

  const rows = await Promise.all(
    providers.map(async (provider) => {
      const channelIds = groups[provider] || [];
      if (!channelIds.length) {
        return {
          provider,
          channelIds: [],
          configured: false,
          todayGptTokens: 0,
          todayQuota: 0,
          recentQuota: 0,
          recentQuotaPerHour: null,
          latestRemainingPercent: null,
          latestUsedPercent: null,
          resetTime: null,
          minutesLeft: null,
          exhaustAt: null,
          status: "unconfigured",
        } satisfies QuotaUsagePredictionRow;
      }

      const [usageResult, snapshotResult] = await Promise.all([
        query<{ today_gpt_tokens: string | number; today_quota: string | number; recent_quota: string | number }>(
          `
            SELECT
              COALESCE(SUM(CASE WHEN l.created_at >= $2 AND ${getGptModelSql("lower(COALESCE(l.model_name, ''))")} THEN l.prompt_tokens + l.completion_tokens ELSE 0 END), 0) AS today_gpt_tokens,
              COALESCE(SUM(CASE WHEN l.created_at >= $2 THEN l.quota ELSE 0 END), 0) AS today_quota,
              COALESCE(SUM(CASE WHEN l.created_at >= $3 THEN l.quota ELSE 0 END), 0) AS recent_quota
            FROM logs l
            WHERE l.channel_id = ANY($1::bigint[])
              AND l.created_at >= LEAST($2, $3)
          `,
          [channelIds, todayStart, recentStart],
        ),
        query<{ remaining_percent: string | number | null; used_percent: string | number | null; reset_time: string | null }>(
          `SELECT remaining_percent, used_percent, reset_time FROM quota_snapshots WHERE provider = $1 ORDER BY sampled_at DESC LIMIT 1`,
          [provider],
        ),
      ]);

      const usage = usageResult.rows[0];
      const snapshot = snapshotResult.rows[0];

      return buildQuotaUsagePrediction({
        provider,
        channelIds,
        todayGptTokens: toNumber(usage?.today_gpt_tokens),
        todayQuota: toNumber(usage?.today_quota),
        recentQuota: toNumber(usage?.recent_quota),
        windowMinutes,
        latestRemainingPercent: nullableNumber(snapshot?.remaining_percent),
        latestUsedPercent: nullableNumber(snapshot?.used_percent),
        resetTime: normalizeResetTime(snapshot?.reset_time),
        nowSeconds,
      });
    }),
  );

  return rows;
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/lib/queries/quota-usage-prediction.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/quota-usage-prediction.ts src/lib/queries/quota-usage-prediction.test.ts src/types/quota.ts
git commit -m "feat: add quota usage prediction queries"
```

---

## Task 4: API Routes

**Files:**
- Create: `src/app/api/quota-usage-snapshots/route.ts`
- Create: `src/app/api/quota-usage-prediction/route.ts`

- [ ] **Step 1: Implement snapshot route**

Create `src/app/api/quota-usage-snapshots/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { aggregateProviderQuotaSnapshot } from "@/lib/quota/usage-aggregation";
import { recordQuotaSnapshots } from "@/lib/queries/quota-usage-prediction";
import type { ProviderType, QuotaData } from "@/types/quota";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SnapshotRequest = {
  providers?: Array<{ provider?: ProviderType; data?: QuotaData[] }>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SnapshotRequest;
    const snapshots = (body.providers || [])
      .map((entry) => (entry.provider && Array.isArray(entry.data) ? aggregateProviderQuotaSnapshot(entry.provider, entry.data) : null))
      .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));

    const result = await recordQuotaSnapshots(snapshots);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error: unknown) {
    console.error("Failed to record quota usage snapshots", error);
    return NextResponse.json(
      { error: "Failed to record quota usage snapshots" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
```

- [ ] **Step 2: Implement prediction route**

Create `src/app/api/quota-usage-prediction/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { getQuotaUsagePredictions } from "@/lib/queries/quota-usage-prediction";
import { normalizeQuotaUsageWindowMinutes } from "@/lib/quota/usage-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const windowMinutes = normalizeQuotaUsageWindowMinutes(request.nextUrl.searchParams.get("windowMinutes"));
    const predictions = await getQuotaUsagePredictions(windowMinutes);
    return NextResponse.json(
      { predictions, windowMinutes },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error: unknown) {
    console.error("Failed to fetch quota usage predictions", error);
    return NextResponse.json(
      { error: "Failed to fetch quota usage predictions" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
```

- [ ] **Step 3: Run route-adjacent tests**

Run:

```bash
node --experimental-strip-types --test src/lib/quota/usage-config.test.ts src/lib/quota/usage-aggregation.test.ts src/lib/queries/quota-usage-prediction.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/quota-usage-snapshots/route.ts src/app/api/quota-usage-prediction/route.ts
git commit -m "feat: add quota usage prediction api"
```

---

## Task 5: Client Hook Integration and UI Panel

**Files:**
- Create: `src/components/quota/quota-prediction-panel.tsx`
- Modify: `src/hooks/useQuota.ts`
- Modify: `src/components/quota/quota-page-client.tsx`

- [ ] **Step 1: Add prediction fetching and snapshot recording to hook**

Modify `src/hooks/useQuota.ts`:

- Import `getProviderType` and prediction types.
- Add `quotaPredictions`, `predictionLoading`, `predictionError`, and `loadQuotaPredictions(windowMinutes)` state/API.
- After `nextQuotas` is built on forced refresh, group successful quota data by provider and POST to `/quota-usage-snapshots`.
- Fetch `/quota-usage-prediction?windowMinutes=${windowMinutes}` when requested.

Expected helper shape inside the hook:

```ts
type PredictionResponse = {
  predictions?: QuotaUsagePredictionRow[];
  windowMinutes?: number;
  error?: string;
};

function buildSnapshotPayload(files: AuthFile[], quotas: Record<string, QuotaState>) {
  const grouped = new Map<ProviderType, QuotaData[]>();

  files.forEach((file) => {
    const provider = getProviderType(file);
    const data = quotas[file.authIndex]?.data;
    if (!data || provider === "unknown") return;
    grouped.set(provider, [...(grouped.get(provider) || []), data]);
  });

  return {
    providers: Array.from(grouped.entries()).map(([provider, data]) => ({ provider, data })),
  };
}
```

- [ ] **Step 2: Create prediction panel component**

Create `src/components/quota/quota-prediction-panel.tsx` with:

- Props: predictions, selectedProvider, windowMinutes, onWindowMinutesChange, loading, error.
- Use `QUOTA_USAGE_WINDOW_OPTIONS` for selector options.
- Compact row formatting for tokens/quota/rate/time.
- Filter rows by selected provider unless selected provider is `all`.

- [ ] **Step 3: Wire panel into quota page**

Modify `src/components/quota/quota-page-client.tsx`:

- Import `QuotaPredictionPanel` and `DEFAULT_QUOTA_USAGE_WINDOW_MINUTES`.
- Add selected `usageWindowMinutes` state defaulting to 720.
- Read new values from `useQuota()`.
- Trigger `loadQuotaPredictions(usageWindowMinutes)` when speed window changes and after quota refresh updates.
- Render panel under provider tabs and before global errors/card grid.

- [ ] **Step 4: Run TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useQuota.ts src/components/quota/quota-prediction-panel.tsx src/components/quota/quota-page-client.tsx
git commit -m "feat: show quota usage predictions"
```

---

## Task 6: Compose and Example Config

**Files:**
- Modify: `docker-compose.portainer.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add compose environment mapping**

Modify `docker-compose.portainer.yml` under `environment`:

```yaml
      QUOTA_USAGE_GROUPS: ${NEW_API_MONITOR_QUOTA_USAGE_GROUPS:-}
```

- [ ] **Step 2: Add env example**

Modify `.env.example`:

```env
QUOTA_USAGE_GROUPS="codex=8,17,19;claude=12,13;zai=27;minimax=24"
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.portainer.yml .env.example
git commit -m "chore: document quota usage group config"
```

---

## Task 7: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

```bash
node --experimental-strip-types --test \
  src/lib/quota/usage-config.test.ts \
  src/lib/quota/usage-aggregation.test.ts \
  src/lib/queries/quota-usage-prediction.test.ts \
  src/lib/quota/auth-files.test.ts \
  src/lib/quota/fetch-policy.test.ts \
  src/lib/quota/sort-policy.test.ts \
  src/lib/quota/upstream.test.ts \
  src/lib/quota/server-proxy.test.ts \
  src/lib/quota/card-ring.test.ts \
  src/lib/quota/zai.test.ts \
  src/lib/quota/minimax.test.ts \
  src/lib/oauth/backend.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Check diff hygiene**

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints no errors. `git status --short` only shows intended uncommitted changes or is clean after final commit.
