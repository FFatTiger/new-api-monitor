import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";

import type { DashboardRollupConfig } from "./rollup-config.ts";
import type { DashboardRollupBatchResult } from "./types.ts";
import type { DashboardRollupWorkPreference } from "./rollup-store.ts";

const disabledConfig: DashboardRollupConfig = {
  workerEnabled: false,
  readsEnabled: false,
  batchSize: 100,
  pauseMs: 500,
  statementTimeoutMs: 5000,
};

const enabledConfig: DashboardRollupConfig = {
  ...disabledConfig,
  workerEnabled: true,
  pauseMs: 20,
  statementTimeoutMs: 1234,
};

function sampleBatch(
  partial: Partial<DashboardRollupBatchResult> = {},
): DashboardRollupBatchResult {
  return {
    lane: "live",
    version: 1,
    fetchedRows: 10,
    claimedRows: 8,
    groupedCells: 24,
    durationMs: 12,
    liveCursorId: "100",
    historyCursorId: "50",
    historyComplete: false,
    lagIdSpan: "5",
    malformedOtherRows: 1,
    ...partial,
  };
}

type ScheduleEntry = {
  delayMs: number;
  callback: () => void;
  id: ReturnType<typeof setTimeout>;
};

function createScheduleHarness() {
  let nextId = 1;
  const entries: ScheduleEntry[] = [];
  const schedule = (callback: () => void, delayMs: number) => {
    const id = nextId++ as unknown as ReturnType<typeof setTimeout>;
    entries.push({ delayMs, callback, id });
    return id;
  };
  return { schedule, entries };
}

async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("dashboard rollup worker", () => {
  beforeEach(async () => {
    const { resetDashboardRollupWorkerForTests } = await import("./rollup-worker.ts");
    resetDashboardRollupWorkerForTests();
  });

  afterEach(async () => {
    const { resetDashboardRollupWorkerForTests } = await import("./rollup-worker.ts");
    resetDashboardRollupWorkerForTests();
  });

  it("does not schedule work when workerEnabled is false and runOnce is not called", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    let runs = 0;
    const state = startDashboardRollupWorker({
      config: disabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      runOnce: async () => {
        runs += 1;
        return null;
      },
    });
    assert.equal(state.started, true);
    assert.equal(state.running, false);
    assert.equal(harness.entries.length, 0);
    assert.equal(runs, 0);
    assert.equal(state.timer, undefined);
  });

  it("returns the same global singleton on repeated start and schedules once", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    let runs = 0;
    const a = startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: false,
      schedule: harness.schedule,
      runOnce: async () => {
        runs += 1;
        return null;
      },
    });
    const b = startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      runOnce: async () => {
        runs += 1;
        return null;
      },
    });
    assert.equal(a, b);
    assert.equal(harness.entries.length, 1);
    assert.equal(runs, 0);
  });

  it("runImmediately true schedules delay 0; false schedules pauseMs", async () => {
    const { startDashboardRollupWorker, resetDashboardRollupWorkerForTests } =
      await import("./rollup-worker.ts");
    {
      const harness = createScheduleHarness();
      startDashboardRollupWorker({
        config: enabledConfig,
        runImmediately: true,
        schedule: harness.schedule,
        runOnce: async () => null,
      });
      assert.equal(harness.entries.length, 1);
      assert.equal(harness.entries[0]!.delayMs, 0);
    }
    resetDashboardRollupWorkerForTests();
    {
      const harness = createScheduleHarness();
      startDashboardRollupWorker({
        config: enabledConfig,
        runImmediately: false,
        schedule: harness.schedule,
        runOnce: async () => null,
      });
      assert.equal(harness.entries.length, 1);
      assert.equal(harness.entries[0]!.delayMs, enabledConfig.pauseMs);
    }
  });

  it("preference sequence is live, live, live, backfill, repeat", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    const preferences: DashboardRollupWorkPreference[] = [];
    startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      runOnce: async (_config, preference) => {
        preferences.push(preference);
        return null;
      },
    });

    for (let i = 0; i < 8; i++) {
      const entry = harness.entries[i];
      assert.ok(entry, `missing scheduled entry ${i}`);
      entry.callback();
      await flushMicrotasks();
    }

    assert.deepEqual(preferences, [
      "live",
      "live",
      "live",
      "backfill",
      "live",
      "live",
      "live",
      "backfill",
    ]);
  });

  it("increments opportunity on null, lock skip, and error", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    const preferences: DashboardRollupWorkPreference[] = [];
    let call = 0;
    const state = startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      logger: { log() {}, warn() {}, error() {} },
      runOnce: async (_config, preference) => {
        preferences.push(preference);
        call += 1;
        if (call === 1) return null;
        if (call === 2) return sampleBatch({ skippedReason: "lock_unavailable" });
        if (call === 3) throw new Error("boom");
        return sampleBatch();
      },
    });

    for (let i = 0; i < 4; i++) {
      harness.entries[i]!.callback();
      await flushMicrotasks();
    }

    assert.equal(state.opportunity, 4);
    assert.deepEqual(preferences, ["live", "live", "live", "backfill"]);
  });

  it("does not overlap while a deferred run is in flight", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    let resolveBatch!: () => void;
    const batchDone = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      runOnce: async () => {
        runs += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await batchDone;
        concurrent -= 1;
        return null;
      },
    });

    // First opportunity starts and stays in-flight.
    harness.entries[0]!.callback();
    await flushMicrotasks();
    assert.equal(runs, 1);
    assert.equal(maxConcurrent, 1);

    // Manual re-entry while running must not start another run.
    // The next schedule only appears after the deferred promise settles.
    assert.equal(harness.entries.length, 1);
    harness.entries[0]!.callback();
    await flushMicrotasks();
    assert.equal(runs, 1);
    assert.equal(maxConcurrent, 1);

    resolveBatch();
    await flushMicrotasks(10);
    assert.equal(harness.entries.length, 2);
    assert.equal(harness.entries[1]!.delayMs, enabledConfig.pauseMs);

    harness.entries[1]!.callback();
    await flushMicrotasks();
    assert.equal(runs, 2);
    assert.equal(maxConcurrent, 1);
  });

  it("schedules next timer only after deferred promise settles with pauseMs", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    let resolveBatch!: () => void;
    const batchDone = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      runOnce: async () => {
        await batchDone;
        return sampleBatch();
      },
    });

    assert.equal(harness.entries[0]!.delayMs, 0);
    harness.entries[0]!.callback();
    await flushMicrotasks();
    assert.equal(harness.entries.length, 1);

    resolveBatch();
    await flushMicrotasks(10);
    assert.equal(harness.entries.length, 2);
    assert.equal(harness.entries[1]!.delayMs, enabledConfig.pauseMs);
  });

  it("logs safe error message and schedules next after failure", async () => {
    const { startDashboardRollupWorker } = await import("./rollup-worker.ts");
    const harness = createScheduleHarness();
    const errors: unknown[][] = [];
    startDashboardRollupWorker({
      config: enabledConfig,
      runImmediately: true,
      schedule: harness.schedule,
      logger: {
        log() {},
        warn() {},
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      },
      runOnce: async () => {
        throw new Error("db exploded without secrets");
      },
    });

    harness.entries[0]!.callback();
    await flushMicrotasks(10);

    assert.equal(errors.length, 1);
    const message = String(errors[0]![errors[0]!.length - 1]);
    assert.match(message, /db exploded without secrets/);
    assert.doesNotMatch(message, /password|DATABASE_URL|statement/i);
    assert.equal(harness.entries.length, 2);
    assert.equal(harness.entries[1]!.delayMs, enabledConfig.pauseMs);
  });

  it("success log includes compact required fields; skipped reasons are not errors", async () => {
    const { startDashboardRollupWorker, resetDashboardRollupWorkerForTests } =
      await import("./rollup-worker.ts");
    const logs: unknown[][] = [];
    const errors: unknown[][] = [];
    const logger = {
      log: (...args: unknown[]) => {
        logs.push(args);
      },
      warn() {},
      error: (...args: unknown[]) => {
        errors.push(args);
      },
    };

    {
      const harness = createScheduleHarness();
      startDashboardRollupWorker({
        config: enabledConfig,
        runImmediately: true,
        schedule: harness.schedule,
        logger,
        runOnce: async () =>
          sampleBatch({
            skippedReason: "source_unhealthy",
            lane: "history",
            version: 2,
          }),
      });
      harness.entries[0]!.callback();
      await flushMicrotasks(10);
    }

    assert.equal(errors.length, 0);
    const compactEntries = logs
      .flat()
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          "lane" in entry &&
          "fetchedRows" in entry,
      );
    assert.ok(
      compactEntries.length >= 1,
      `expected compact success log, got ${JSON.stringify(logs)}`,
    );
    const compact = compactEntries[0]!;
    for (const field of [
      "lane",
      "version",
      "fetchedRows",
      "claimedRows",
      "groupedCells",
      "durationMs",
      "liveCursorId",
      "historyCursorId",
      "historyComplete",
      "lagIdSpan",
      "malformedOtherRows",
      "skippedReason",
    ] as const) {
      assert.ok(field in compact, `missing field ${field}`);
    }
    assert.equal(compact.skippedReason, "source_unhealthy");
    assert.equal(compact.lane, "history");
    assert.equal(compact.version, 2);

    resetDashboardRollupWorkerForTests();
    logs.length = 0;
    {
      const harness = createScheduleHarness();
      startDashboardRollupWorker({
        config: enabledConfig,
        runImmediately: true,
        schedule: harness.schedule,
        logger,
        runOnce: async () =>
          sampleBatch({ skippedReason: "version_inactive", lane: "gap" }),
      });
      harness.entries[0]!.callback();
      await flushMicrotasks(10);
    }
    assert.equal(errors.length, 0);
  });

  it("runDashboardRollupOnce returns null before DB when disabled", async () => {
    const { runDashboardRollupOnce, runDashboardRollupWithDependencies } =
      await import("./rollup-worker.ts");
    let withTransactionCalls = 0;
    const result = await runDashboardRollupWithDependencies(
      disabledConfig,
      "live",
      {
        withTransaction: async <T,>(callback: unknown, options?: unknown): Promise<T> => {
          void callback;
          void options;
          withTransactionCalls += 1;
          return null as T;
        },
      },
    );
    assert.equal(result, null);
    assert.equal(withTransactionCalls, 0);

    // Public entry also short-circuits without opening a client when disabled.
    const publicResult = await runDashboardRollupOnce(disabledConfig, "live");
    assert.equal(publicResult, null);
  });

  it("transaction options include timeout, parallel disabled, read committed", async () => {
    const { runDashboardRollupWithDependencies } = await import("./rollup-worker.ts");
    let seenOptions: unknown;
    let callbackRan = false;
    const batch = sampleBatch();
    const result = await runDashboardRollupWithDependencies(
      enabledConfig,
      "backfill",
      {
        withTransaction: async (cb, options) => {
          seenOptions = options;
          callbackRan = true;
          return cb({
            query: async () => ({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] }),
          } as never);
        },
        ensureSchema: async () => {},
        initializeRegistry: async () =>
          ({
            version: 1,
            sourceTableOid: 1,
            sourceBoundaryId: BigInt(0),
            liveCursorId: BigInt(0),
            historyCursorId: null,
            historyComplete: true,
            status: "active",
          }) as never,
        selectWorkItem: async () => ({ lane: "live", version: 1 }),
        processWorkItem: async () => batch,
        nowSeconds: () => 1_700_000_000,
        executableVersions: () => [1],
      },
    );
    assert.equal(callbackRan, true);
    assert.deepEqual(seenOptions, {
      statementTimeoutMs: enabledConfig.statementTimeoutMs,
      disableParallelGather: true,
      isolationLevel: "read committed",
    });
    assert.equal(result, batch);
  });

  it("initializes schema/registry once and retries after init failure", async () => {
    const {
      runDashboardRollupWithDependencies,
      resetDashboardRollupWorkerForTests,
    } = await import("./rollup-worker.ts");

    let ensureCalls = 0;
    let initCalls = 0;
    let selectCalls = 0;
    let failInit = true;

    const depsBase = {
      withTransaction: async (
        cb: (client: { query: () => Promise<unknown> }) => Promise<unknown>,
      ) =>
        cb({
          query: async () => ({ rows: [] }),
        }),
      ensureSchema: async () => {
        ensureCalls += 1;
      },
      initializeRegistry: async () => {
        initCalls += 1;
        if (failInit) throw new Error("init failed");
        return {
          version: 1,
          sourceTableOid: 1,
          sourceBoundaryId: BigInt(0),
          liveCursorId: BigInt(0),
          historyCursorId: null,
          historyComplete: true,
          status: "active" as const,
        };
      },
      selectWorkItem: async () => {
        selectCalls += 1;
        return null;
      },
      processWorkItem: async () => sampleBatch(),
      nowSeconds: () => 10,
      executableVersions: () => [1],
    };

    await assert.rejects(
      () =>
        runDashboardRollupWithDependencies(enabledConfig, "live", depsBase as never),
      /init failed/,
    );
    assert.equal(ensureCalls, 1);
    assert.equal(initCalls, 1);
    assert.equal(selectCalls, 0);

    // Still failed previously → retries init on next attempt.
    failInit = false;
    const second = await runDashboardRollupWithDependencies(
      enabledConfig,
      "live",
      depsBase as never,
    );
    assert.equal(second, null);
    assert.equal(ensureCalls, 2);
    assert.equal(initCalls, 2);
    assert.equal(selectCalls, 1);

    // Successful init is not repeated.
    const third = await runDashboardRollupWithDependencies(
      enabledConfig,
      "backfill",
      depsBase as never,
    );
    assert.equal(third, null);
    assert.equal(ensureCalls, 2);
    assert.equal(initCalls, 2);
    assert.equal(selectCalls, 2);

    resetDashboardRollupWorkerForTests();
    ensureCalls = 0;
    initCalls = 0;
    selectCalls = 0;
    const afterReset = await runDashboardRollupWithDependencies(
      enabledConfig,
      "live",
      depsBase as never,
    );
    assert.equal(afterReset, null);
    assert.equal(ensureCalls, 1);
    assert.equal(initCalls, 1);
  });

  it("instrumentation source starts both workers under Node guard", () => {
    const instrumentationPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../instrumentation.ts",
    );
    const source = readFileSync(instrumentationPath, "utf8");
    assert.match(source, /NEXT_RUNTIME === ["']nodejs["']/);
    assert.match(source, /startQuotaBackgroundSampler/);
    assert.match(source, /startDashboardRollupWorker/);
    assert.match(source, /Promise\.all/);
    assert.match(
      source,
      /lib\/quota\/background-sampler|lib\/dashboard\/rollup-worker/,
    );
  });

  it("worker source does not use setInterval", () => {
    const workerPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "rollup-worker.ts",
    );
    const source = readFileSync(workerPath, "utf8");
    assert.equal(/setInterval/.test(source), false);
  });

  it("exports getExecutableDashboardRollupVersions with formula v1", async () => {
    const { getExecutableDashboardRollupVersions } = await import(
      "./rollup-normalizer.ts"
    );
    assert.deepEqual(getExecutableDashboardRollupVersions(), [1]);
  });
});
