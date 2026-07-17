import type { DbClient, TransactionOptions } from "../db.ts";
import { withTransaction } from "../db.ts";
import {
  DASHBOARD_ROLLUP_VERSION,
  getDashboardRollupConfig,
  type DashboardRollupConfig,
} from "./rollup-config.ts";
import { getExecutableDashboardRollupVersions } from "./rollup-normalizer.ts";
import {
  ensureDashboardRollupSchema,
  initializeDashboardRollupRegistry,
} from "./rollup-schema.ts";
import {
  processDashboardRollupWorkItem,
  selectDashboardRollupWorkItem,
  type DashboardRollupWorkPreference,
} from "./rollup-store.ts";
import type {
  DashboardRollupBatchResult,
  DashboardRollupWorkItem,
} from "./types.ts";

export interface DashboardRollupWorkerState {
  started: boolean;
  running: boolean;
  opportunity: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface DashboardRollupWorkerOptions {
  config?: DashboardRollupConfig;
  runOnce?: (
    config: DashboardRollupConfig,
    preference: DashboardRollupWorkPreference,
  ) => Promise<DashboardRollupBatchResult | null>;
  logger?: Pick<Console, "error" | "log" | "warn">;
  runImmediately?: boolean;
  schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
}

export interface DashboardRollupRunDependencies {
  withTransaction?: <T>(
    callback: (client: DbClient) => Promise<T>,
    options?: TransactionOptions,
  ) => Promise<T>;
  ensureSchema?: (client: DbClient) => Promise<void>;
  initializeRegistry?: (
    client: DbClient,
    executableVersions: readonly number[],
    buildingVersion: number,
    nowSeconds: number,
  ) => Promise<unknown>;
  selectWorkItem?: (
    client: DbClient,
    nowSeconds: number,
    preference: DashboardRollupWorkPreference,
  ) => Promise<DashboardRollupWorkItem | null>;
  processWorkItem?: (
    client: DbClient,
    item: DashboardRollupWorkItem,
    config: DashboardRollupConfig,
    nowSeconds: number,
  ) => Promise<DashboardRollupBatchResult>;
  nowSeconds?: () => number;
  executableVersions?: () => number[];
}

declare global {
  // eslint-disable-next-line no-var
  var __newApiMonitorDashboardRollupWorkerState:
    | DashboardRollupWorkerState
    | undefined;
}

/**
 * Process-local init gate.
 * Set only after a transaction that performed init commits successfully,
 * so a rolled-back init is retried. Cleared on failure paths via no write.
 */
let schemaInitialized = false;

function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function preferenceForOpportunity(
  opportunity: number,
): DashboardRollupWorkPreference {
  // opportunity 0,1,2 → live; 3 → backfill; then repeat
  return (opportunity + 1) % 4 === 0 ? "backfill" : "live";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logBatchResult(
  logger: Pick<Console, "error" | "log" | "warn">,
  result: DashboardRollupBatchResult,
): void {
  logger.log({
    lane: result.lane,
    version: result.version,
    fetchedRows: result.fetchedRows,
    claimedRows: result.claimedRows,
    groupedCells: result.groupedCells,
    durationMs: result.durationMs,
    liveCursorId: result.liveCursorId,
    historyCursorId: result.historyCursorId,
    historyComplete: result.historyComplete,
    lagIdSpan: result.lagIdSpan,
    malformedOtherRows: result.malformedOtherRows,
    skippedReason: result.skippedReason,
  });
}

/**
 * Production-generic helper for a single rollup opportunity with injectable deps.
 * Prefer this from tests; production uses `runDashboardRollupOnce`.
 */
export async function runDashboardRollupWithDependencies(
  config: DashboardRollupConfig,
  preference: DashboardRollupWorkPreference = "live",
  deps: DashboardRollupRunDependencies = {},
): Promise<DashboardRollupBatchResult | null> {
  if (!config.workerEnabled) {
    return null;
  }

  const withTxn = deps.withTransaction ?? withTransaction;
  const ensureSchema = deps.ensureSchema ?? ensureDashboardRollupSchema;
  const initializeRegistry =
    deps.initializeRegistry ?? initializeDashboardRollupRegistry;
  const selectWorkItem = deps.selectWorkItem ?? selectDashboardRollupWorkItem;
  const processWorkItem =
    deps.processWorkItem ?? processDashboardRollupWorkItem;
  const nowSeconds = deps.nowSeconds ?? defaultNowSeconds;
  const executableVersions =
    deps.executableVersions ?? getExecutableDashboardRollupVersions;

  let performedInit = false;

  try {
    const result = await withTxn(
      async (client) => {
        if (!schemaInitialized) {
          await ensureSchema(client);
          await initializeRegistry(
            client,
            executableVersions(),
            DASHBOARD_ROLLUP_VERSION,
            nowSeconds(),
          );
          performedInit = true;
        }

        const item = await selectWorkItem(client, nowSeconds(), preference);
        if (!item) return null;
        return processWorkItem(client, item, config, nowSeconds());
      },
      {
        statementTimeoutMs: config.statementTimeoutMs,
        disableParallelGather: true,
        isolationLevel: "read committed",
      },
    );

    // Only mark initialized after the transaction commits (withTxn returned).
    if (performedInit) {
      schemaInitialized = true;
    }
    return result;
  } catch (error) {
    // Init inside a failed/rolled-back transaction must be retried.
    if (performedInit) {
      schemaInitialized = false;
    }
    throw error;
  }
}

export async function runDashboardRollupOnce(
  config: DashboardRollupConfig = getDashboardRollupConfig(),
  preference: DashboardRollupWorkPreference = "live",
): Promise<DashboardRollupBatchResult | null> {
  return runDashboardRollupWithDependencies(config, preference);
}

export function startDashboardRollupWorker(
  options: DashboardRollupWorkerOptions = {},
): DashboardRollupWorkerState {
  const existing = globalThis.__newApiMonitorDashboardRollupWorkerState;
  if (existing?.started) {
    return existing;
  }

  const state: DashboardRollupWorkerState = existing ?? {
    started: false,
    running: false,
    opportunity: 0,
  };
  globalThis.__newApiMonitorDashboardRollupWorkerState = state;

  const config = options.config ?? getDashboardRollupConfig();
  const logger = options.logger ?? console;
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const runImmediately = options.runImmediately ?? true;
  const runOnce =
    options.runOnce ??
    ((cfg: DashboardRollupConfig, preference: DashboardRollupWorkPreference) =>
      runDashboardRollupOnce(cfg, preference));

  state.started = true;

  if (!config.workerEnabled) {
    return state;
  }

  const scheduleNext = (delayMs: number) => {
    state.timer = schedule(() => {
      void tick();
    }, delayMs);
  };

  const tick = async () => {
    // Non-overlap: ignore re-entry; the in-flight run schedules the only next tick.
    if (state.running) {
      return;
    }

    state.running = true;
    const preference = preferenceForOpportunity(state.opportunity);
    // Increment exactly once per scheduled attempt (null / skip / error included).
    state.opportunity += 1;

    try {
      const result = await runOnce(config, preference);
      if (result) {
        logBatchResult(logger, result);
      }
    } catch (error: unknown) {
      logger.error(
        "Dashboard rollup worker failed",
        safeErrorMessage(error),
      );
    } finally {
      state.running = false;
      scheduleNext(config.pauseMs);
    }
  };

  logger.log("Dashboard rollup worker started");
  scheduleNext(runImmediately ? 0 : config.pauseMs);
  return state;
}

/**
 * Reset process-local worker singleton and init gate.
 * Production-generic export used by tests; also safe after hot-reload.
 */
export function resetDashboardRollupWorkerForTests(): void {
  const state = globalThis.__newApiMonitorDashboardRollupWorkerState;
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  globalThis.__newApiMonitorDashboardRollupWorkerState = undefined;
  schemaInitialized = false;
}
