import type { AuthFile } from "../../types/auth.ts";
import type { ProviderType, QuotaData, QuotaState } from "../../types/quota.ts";

import { query, withClient } from "../db.ts";

export type QuotaLatestRow = {
  authIndex: string;
  provider: ProviderType;
  quotaData: QuotaData | null;
  error: string | null;
  sampledAt: number;
  successCount: number;
  failureCount: number;
};

export type QuotaLatestInput = QuotaLatestRow;

type QuotaLatestDbRow = {
  auth_index: string;
  provider: ProviderType;
  quota_data: QuotaData | null;
  error: string | null;
  sampled_at: string | number;
  success_count: string | number | null;
  failure_count: string | number | null;
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeLatestDbRow(row: QuotaLatestDbRow): QuotaLatestRow {
  return {
    authIndex: String(row.auth_index),
    provider: row.provider,
    quotaData: row.quota_data ?? null,
    error: row.error ?? null,
    sampledAt: toNumber(row.sampled_at),
    successCount: toNumber(row.success_count),
    failureCount: toNumber(row.failure_count),
  };
}

export function buildQuotaStatesFromLatestRows(files: AuthFile[], rows: QuotaLatestRow[]): Record<string, QuotaState> {
  const rowsByAuthIndex = new Map(rows.map((row) => [row.authIndex, row] as const));
  const states: Record<string, QuotaState> = {};

  files.forEach((file) => {
    const row = rowsByAuthIndex.get(file.authIndex);
    if (!row) {
      states[file.authIndex] = { loading: false, error: "等待后台采样" };
      return;
    }

    const state: QuotaState = {
      loading: false,
      lastUpdated: row.sampledAt * 1000,
      successCount: row.successCount,
      failureCount: row.failureCount,
    };

    if (row.error) {
      state.error = row.error;
    } else if (row.quotaData) {
      state.data = row.quotaData;
    } else {
      state.error = "等待后台采样";
    }

    states[file.authIndex] = state;
  });

  return states;
}

export async function ensureQuotaLatestTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS quota_latest (
      auth_index TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      quota_data JSONB,
      error TEXT,
      sampled_at BIGINT NOT NULL,
      success_count BIGINT NOT NULL DEFAULT 0,
      failure_count BIGINT NOT NULL DEFAULT 0
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_quota_latest_provider_sampled_at ON quota_latest (provider, sampled_at DESC)`);
}

export async function upsertQuotaLatestRows(rows: QuotaLatestInput[]) {
  if (!rows.length) return { upserted: 0 };

  await ensureQuotaLatestTable();
  await withClient(async (client) => {
    for (const row of rows) {
      await client.query(
        `
          INSERT INTO quota_latest (auth_index, provider, quota_data, error, sampled_at, success_count, failure_count)
          VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
          ON CONFLICT (auth_index) DO UPDATE SET
            provider = EXCLUDED.provider,
            quota_data = EXCLUDED.quota_data,
            error = EXCLUDED.error,
            sampled_at = EXCLUDED.sampled_at,
            success_count = EXCLUDED.success_count,
            failure_count = EXCLUDED.failure_count
        `,
        [
          row.authIndex,
          row.provider,
          row.quotaData === null ? null : JSON.stringify(row.quotaData),
          row.error,
          row.sampledAt,
          row.successCount,
          row.failureCount,
        ],
      );
    }
  });

  return { upserted: rows.length };
}

export async function getQuotaLatestRows(authIndexes?: string[]) {
  await ensureQuotaLatestTable();

  const normalizedAuthIndexes = authIndexes?.map((authIndex) => authIndex.trim()).filter(Boolean) || [];
  const result = normalizedAuthIndexes.length
    ? await query<QuotaLatestDbRow>(
        `SELECT auth_index, provider, quota_data, error, sampled_at, success_count, failure_count FROM quota_latest WHERE auth_index = ANY($1::text[])`,
        [normalizedAuthIndexes],
      )
    : await query<QuotaLatestDbRow>(
        `SELECT auth_index, provider, quota_data, error, sampled_at, success_count, failure_count FROM quota_latest`,
      );

  return result.rows.map(normalizeLatestDbRow);
}
