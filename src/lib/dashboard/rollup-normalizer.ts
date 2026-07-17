import { createHash } from "node:crypto";

import {
  DASHBOARD_DIMENSION_BITS,
  DASHBOARD_DIMENSION_MASKS,
  DASHBOARD_ROLLUP_GRAINS,
  DASHBOARD_ROLLUP_VERSION,
} from "./rollup-config.ts";
import {
  getDashboardAllBucket,
  getDashboardHourBucket,
  getDashboardMinuteBucket,
  getDashboardShanghaiDayBucket,
} from "./rollup-time.ts";
import type {
  DashboardDimensionKey,
  DashboardRollupFormula,
  DashboardRollupGrain,
  DashboardRollupMask,
  DashboardRollupMetricTotals,
  DashboardSourceLogRow,
  HashedDashboardDimensionKey,
  NormalizedDashboardLog,
  PendingDashboardRollupCell,
} from "./types.ts";

const FRT_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;
const INTEGER_PATTERN = /^-?\d+$/;

type FormulaRegistry = Map<number, DashboardRollupFormula>;

const formulaRegistry: FormulaRegistry = new Map();

function registerFormula(formula: DashboardRollupFormula): void {
  formulaRegistry.set(formula.version, formula);
}

function throwInvalidInteger(label: string, value: unknown): never {
  throw new TypeError(`invalid ${label}: ${String(value)}`);
}

/** True only when a JS number can be converted to bigint without rounding. */
function isSafeIntegerNumber(value: number): boolean {
  return Number.isSafeInteger(value);
}

/** Parse required integer identifiers. Throws on invalid/unsafe number values. */
function parseRequiredBigInt(label: string, value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!isSafeIntegerNumber(value)) {
      throwInvalidInteger(label, value);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!INTEGER_PATTERN.test(trimmed)) {
      throwInvalidInteger(label, value);
    }
    try {
      return BigInt(trimmed);
    } catch {
      throwInvalidInteger(label, value);
    }
  }
  throwInvalidInteger(label, value);
}

/** Parse required created_at as finite integer unix seconds (number). No truncation. */
function parseRequiredCreatedAt(value: string | number | bigint): number {
  if (typeof value === "number") {
    if (!isSafeIntegerNumber(value)) {
      throw new TypeError(`invalid created_at: ${String(value)}`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== value) {
      throw new TypeError(`invalid created_at: ${String(value)}`);
    }
    return asNumber;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!INTEGER_PATTERN.test(trimmed)) {
      throw new TypeError(`invalid created_at: ${String(value)}`);
    }
    const asBig = BigInt(trimmed);
    const asNumber = Number(asBig);
    if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== asBig) {
      throw new TypeError(`invalid created_at: ${String(value)}`);
    }
    return asNumber;
  }
  throw new TypeError(`invalid created_at: ${String(value)}`);
}

/**
 * Optional bigint IDs: null/undefined/"" → null; invalid/unsafe number → null + invalid.
 * Does not throw for optional fields. Exact string integers of any magnitude are accepted.
 */
function parseOptionalBigInt(
  value: string | number | bigint | null | undefined,
): { value: bigint | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };
  if (typeof value === "bigint") return { value, invalid: false };
  if (typeof value === "number") {
    if (!isSafeIntegerNumber(value)) {
      return { value: null, invalid: true };
    }
    return { value: BigInt(value), invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { value: null, invalid: false };
    if (!INTEGER_PATTERN.test(trimmed)) return { value: null, invalid: true };
    try {
      return { value: BigInt(trimmed), invalid: false };
    } catch {
      return { value: null, invalid: true };
    }
  }
  return { value: null, invalid: true };
}

/**
 * Token metric integers: invalid/unsafe number → BigInt(0) + invalid flag.
 * Exact bigint; never BigInt(rounded number). Exact integer strings remain supported.
 */
function parseTokenMetric(
  value: string | number | bigint | null | undefined,
): { value: bigint; invalid: boolean } {
  if (value === null || value === undefined) return { value: BigInt(0), invalid: false };
  if (typeof value === "bigint") return { value, invalid: false };
  if (typeof value === "number") {
    if (!isSafeIntegerNumber(value)) {
      return { value: BigInt(0), invalid: true };
    }
    return { value: BigInt(value), invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { value: BigInt(0), invalid: false };
    if (!INTEGER_PATTERN.test(trimmed)) return { value: BigInt(0), invalid: true };
    try {
      return { value: BigInt(trimmed), invalid: false };
    } catch {
      return { value: BigInt(0), invalid: true };
    }
  }
  return { value: BigInt(0), invalid: true };
}

function parseOptionalNumber(
  value: string | number | bigint | null | undefined,
): { value: number | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { value: null, invalid: true };
    return { value, invalid: false };
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) return { value: null, invalid: true };
    return { value: asNumber, invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { value: null, invalid: false };
    // Reject exponent / non-decimal forms for use_time by requiring finite Number.
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return { value: null, invalid: true };
    // Avoid silent truncation of huge integers for use_time; still store as number.
    return { value: parsed, invalid: false };
  }
  return { value: null, invalid: true };
}

function normalizeModelName(value: string | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  const stripped = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped === "" ? "Unknown" : stripped;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value === "" ? null : value;
}

/**
 * JSON integer field → bigint. Unsafe/non-integer numbers return 0 with invalid=true
 * so the row can be marked malformed rather than silently rounded.
 */
function parseOtherJsonFieldAsBigInt(value: unknown): { value: bigint; invalid: boolean } {
  if (typeof value === "bigint") return { value, invalid: false };
  if (typeof value === "number") {
    if (!isSafeIntegerNumber(value)) return { value: BigInt(0), invalid: true };
    return { value: BigInt(value), invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { value: BigInt(0), invalid: false };
    if (!INTEGER_PATTERN.test(trimmed)) return { value: BigInt(0), invalid: true };
    try {
      return { value: BigInt(trimmed), invalid: false };
    } catch {
      return { value: BigInt(0), invalid: true };
    }
  }
  if (value === null || value === undefined) return { value: BigInt(0), invalid: false };
  return { value: BigInt(0), invalid: true };
}

function parseFrt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    // JSON numbers may arrive already-parsed; only accept non-negative finite without needing string form.
    // Spec requires string form match for frt from JSON text; when already a number from JSON.parse,
    // reject non-integers that would have used exponent only if they came as strings.
    if (!Number.isFinite(value) || value < 0) return null;
    // JSON.parse("1e3") yields 1000 — we can't see original form; require exact decimal via string path only.
    // When the value is a number from JSON, convert via String and re-check pattern to reject scientific.
    const asString = String(value);
    if (!FRT_PATTERN.test(asString)) return null;
    return value;
  }
  if (typeof value !== "string") return null;
  if (!FRT_PATTERN.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

interface ParsedOther {
  malformedOther: boolean;
  cacheTokens: bigint;
  usageSemantic: string | null;
  firstTokenLatency: number | null;
}

function parseOther(other: string | null): ParsedOther {
  if (other === null || !other.startsWith("{")) {
    return {
      malformedOther: false,
      cacheTokens: BigInt(0),
      usageSemantic: null,
      firstTokenLatency: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(other);
  } catch {
    return {
      malformedOther: true,
      cacheTokens: BigInt(0),
      usageSemantic: null,
      firstTokenLatency: null,
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      malformedOther: true,
      cacheTokens: BigInt(0),
      usageSemantic: null,
      firstTokenLatency: null,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const baseCache = parseOtherJsonFieldAsBigInt(obj.cache_tokens);
  const fiveMin = parseOtherJsonFieldAsBigInt(obj.cache_creation_tokens_5m);
  const oneHour = parseOtherJsonFieldAsBigInt(obj.cache_creation_tokens_1h);
  const creation = parseOtherJsonFieldAsBigInt(obj.cache_creation_tokens);
  const integerFieldInvalid =
    baseCache.invalid || fiveMin.invalid || oneHour.invalid || creation.invalid;
  const creationPart =
    fiveMin.value > BigInt(0) || oneHour.value > BigInt(0)
      ? fiveMin.value + oneHour.value
      : creation.value;
  const cacheTokens = baseCache.value + creationPart;

  const usageSemantic =
    typeof obj.usage_semantic === "string" ? obj.usage_semantic : null;
  const firstTokenLatency = parseFrt(obj.frt);

  return {
    malformedOther: integerFieldInvalid,
    cacheTokens: integerFieldInvalid ? BigInt(0) : cacheTokens,
    usageSemantic: integerFieldInvalid ? null : usageSemantic,
    firstTokenLatency: integerFieldInvalid ? null : firstTokenLatency,
  };
}

function normalizeFormulaV1(row: DashboardSourceLogRow): NormalizedDashboardLog {
  const sourceId = parseRequiredBigInt("id", row.id);
  const createdAt = parseRequiredCreatedAt(row.created_at);

  const tokenId = parseOptionalBigInt(row.token_id);
  const userId = parseOptionalBigInt(row.user_id);
  const channelId = parseOptionalBigInt(row.channel_id);
  const prompt = parseTokenMetric(row.prompt_tokens);
  const completion = parseTokenMetric(row.completion_tokens);
  const typeParsed = parseOptionalBigInt(row.type);
  const useTime = parseOptionalNumber(row.use_time);

  // Invalid optional IDs become null without a throw. Invalid token metrics become 0n
  // and mark the row as malformed/diagnostic. Type/use_time invalidity zero their contributions.
  let malformedOther = prompt.invalid || completion.invalid;

  const other = parseOther(row.other);
  if (other.malformedOther) malformedOther = true;

  const cacheTokens = other.cacheTokens;
  const inputTokens =
    !other.malformedOther && other.usageSemantic === "anthropic"
      ? prompt.value + cacheTokens
      : prompt.value;

  const typeNum = typeParsed.value;
  const isType2 = typeNum === BigInt(2);
  const isType5 = typeNum === BigInt(5);
  const attemptCount: bigint = isType2 || isType5 ? BigInt(1) : BigInt(0);
  const successCount: bigint = isType2 ? BigInt(1) : BigInt(0);
  const errorCount: bigint = isType5 ? BigInt(1) : BigInt(0);

  // First-token latency is only meaningful for type=2 averages in SQL FILTER, but the
  // normalized field stores the validated value when present; emission applies count.
  // Matching SQL: AVG(valid_frt) FILTER (WHERE type=2) — only contribute when type 2.
  let firstTokenLatency: number | null = null;
  if (isType2 && !other.malformedOther) {
    firstTokenLatency = other.firstTokenLatency;
  }

  let responseTime: number | null = null;
  if (isType2 && useTime.value !== null && useTime.value !== 0) {
    responseTime = useTime.value;
  }

  let outputTokensPerSec: number | null = null;
  if (
    isType2 &&
    useTime.value !== null &&
    useTime.value > 0 &&
    completion.value > BigInt(0)
  ) {
    // Reject speed contribution when completion cannot convert to a safe number.
    if (
      completion.value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      completion.value >= BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      const completionNumber = Number(completion.value);
      if (Number.isSafeInteger(completionNumber)) {
        outputTokensPerSec = completionNumber / useTime.value;
      }
    }
  }

  return {
    sourceId,
    createdAt,
    tokenId: tokenId.value,
    tokenName: row.token_name,
    userId: userId.value,
    username: row.username,
    modelName: normalizeModelName(row.model_name),
    channelId: channelId.value,
    channelName: row.channel_name,
    requestCount: BigInt(1),
    inputTokens,
    outputTokens: completion.value,
    cacheTokens: other.malformedOther ? BigInt(0) : cacheTokens,
    attemptCount,
    successCount,
    errorCount,
    firstTokenLatency,
    responseTime,
    outputTokensPerSec,
    malformedOther,
  };
}

const formulaV1: DashboardRollupFormula = {
  version: DASHBOARD_ROLLUP_VERSION,
  normalize: normalizeFormulaV1,
};

registerFormula(formulaV1);

export function getDashboardRollupFormula(version: number): DashboardRollupFormula {
  const formula = formulaRegistry.get(version);
  if (!formula) {
    throw new Error(`Unknown dashboard rollup formula version: ${version}`);
  }
  return formula;
}

/** Sorted executable formula versions known to this process. */
export function getExecutableDashboardRollupVersions(): number[] {
  return Array.from(formulaRegistry.keys()).sort((a, b) => a - b);
}

export function normalizeDashboardSourceRow(
  row: DashboardSourceLogRow,
): NormalizedDashboardLog {
  return getDashboardRollupFormula(DASHBOARD_ROLLUP_VERSION).normalize(row);
}

const TAG_NULL = 0;
const TAG_BIGINT = 1;
const TAG_STRING = 2;

function writeU32(buf: Buffer, offset: number, value: number): number {
  buf.writeUInt32BE(value >>> 0, offset);
  return offset + 4;
}

function encodeNullableBigInt(value: bigint | null): Buffer {
  if (value === null) {
    return Buffer.from([TAG_NULL]);
  }
  // Length-prefixed decimal string of the bigint for stable encoding without size limits.
  const text = value.toString();
  const textBuf = Buffer.from(text, "utf8");
  const out = Buffer.allocUnsafe(1 + 4 + textBuf.length);
  out[0] = TAG_BIGINT;
  writeU32(out, 1, textBuf.length);
  textBuf.copy(out, 5);
  return out;
}

function encodeNullableString(value: string | null): Buffer {
  if (value === null) {
    return Buffer.from([TAG_NULL]);
  }
  const textBuf = Buffer.from(value, "utf8");
  const out = Buffer.allocUnsafe(1 + 4 + textBuf.length);
  out[0] = TAG_STRING;
  writeU32(out, 1, textBuf.length);
  textBuf.copy(out, 5);
  return out;
}

export function hashDashboardDimensionKey(key: DashboardDimensionKey): Buffer {
  const hash = createHash("sha256");
  // Mask as uint16 BE for explicit fixed-width.
  const maskBuf = Buffer.allocUnsafe(2);
  maskBuf.writeUInt16BE(key.dimensionMask, 0);
  hash.update(maskBuf);
  hash.update(encodeNullableBigInt(key.tokenId));
  hash.update(encodeNullableString(key.tokenName));
  hash.update(encodeNullableBigInt(key.userId));
  hash.update(encodeNullableString(key.username));
  hash.update(encodeNullableString(key.modelName));
  hash.update(encodeNullableBigInt(key.channelId));
  return hash.digest();
}

export function assertDimensionKeyMatchesStored(
  expected: DashboardDimensionKey,
  stored: DashboardDimensionKey,
): void {
  if (
    expected.dimensionMask !== stored.dimensionMask ||
    expected.tokenId !== stored.tokenId ||
    expected.tokenName !== stored.tokenName ||
    expected.userId !== stored.userId ||
    expected.username !== stored.username ||
    expected.modelName !== stored.modelName ||
    expected.channelId !== stored.channelId
  ) {
    throw new Error("dashboard dimension hash collision/mismatch with stored key values");
  }
}

export type DashboardDimensionHashFn = (key: DashboardDimensionKey) => Buffer;

function buildKeyForMask(
  row: NormalizedDashboardLog,
  mask: DashboardRollupMask,
  hashFn: DashboardDimensionHashFn = hashDashboardDimensionKey,
): HashedDashboardDimensionKey {
  const includeToken = (mask & DASHBOARD_DIMENSION_BITS.token) !== 0;
  const includeUser = (mask & DASHBOARD_DIMENSION_BITS.user) !== 0;
  const includeModel = (mask & DASHBOARD_DIMENSION_BITS.model) !== 0;
  const includeChannel = (mask & DASHBOARD_DIMENSION_BITS.channel) !== 0;

  const key: DashboardDimensionKey = {
    dimensionMask: mask,
    tokenId: includeToken ? row.tokenId : null,
    tokenName: includeToken ? row.tokenName : null,
    userId: includeUser ? row.userId : null,
    username: includeUser ? row.username : null,
    modelName: includeModel ? row.modelName : null,
    channelId: includeChannel ? row.channelId : null,
  };
  return { ...key, hash: hashFn(key) };
}

export function buildDashboardDimensionKeys(
  row: NormalizedDashboardLog,
  hashFn: DashboardDimensionHashFn = hashDashboardDimensionKey,
): HashedDashboardDimensionKey[] {
  return DASHBOARD_DIMENSION_MASKS.map((mask) => buildKeyForMask(row, mask, hashFn));
}

function toMetrics(row: NormalizedDashboardLog): DashboardRollupMetricTotals {
  const hasFrt = row.firstTokenLatency !== null;
  const hasResponse = row.responseTime !== null;
  const hasSpeed = row.outputTokensPerSec !== null;
  return {
    requestCount: row.requestCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheTokens: row.cacheTokens,
    attemptCount: row.attemptCount,
    successCount: row.successCount,
    errorCount: row.errorCount,
    firstTokenLatencySum: hasFrt ? row.firstTokenLatency! : 0,
    firstTokenLatencyCount: hasFrt ? BigInt(1) : BigInt(0),
    responseTimeSum: hasResponse ? row.responseTime! : 0,
    responseTimeCount: hasResponse ? BigInt(1) : BigInt(0),
    outputTokensPerSecSum: hasSpeed ? row.outputTokensPerSec! : 0,
    outputTokensPerSecCount: hasSpeed ? BigInt(1) : BigInt(0),
    firstUsedAt: row.createdAt,
    latestUsedAt: row.createdAt,
    representativeUserId: row.userId,
    representativeUsername: emptyToNull(row.username),
    representativeChannelName: emptyToNull(row.channelName),
  };
}

const GRAIN_SPECS: Array<{ grain: DashboardRollupGrain; bucket: (ts: number) => number }> = [
  { grain: DASHBOARD_ROLLUP_GRAINS.minute, bucket: getDashboardMinuteBucket },
  { grain: DASHBOARD_ROLLUP_GRAINS.hour, bucket: getDashboardHourBucket },
  { grain: DASHBOARD_ROLLUP_GRAINS.day, bucket: getDashboardShanghaiDayBucket },
  { grain: DASHBOARD_ROLLUP_GRAINS.all, bucket: () => getDashboardAllBucket() },
];

export function emitDashboardRollupCells(
  row: NormalizedDashboardLog,
  keys?: HashedDashboardDimensionKey[],
  hashFn: DashboardDimensionHashFn = hashDashboardDimensionKey,
): PendingDashboardRollupCell[] {
  const dimensionKeys = keys ?? buildDashboardDimensionKeys(row, hashFn);
  const metrics = toMetrics(row);
  const cells: PendingDashboardRollupCell[] = [];
  for (const key of dimensionKeys) {
    for (const { grain, bucket } of GRAIN_SPECS) {
      cells.push({
        grain,
        bucketStart: bucket(row.createdAt),
        dimensionMask: key.dimensionMask,
        dimension: {
          dimensionMask: key.dimensionMask,
          tokenId: key.tokenId,
          tokenName: key.tokenName,
          userId: key.userId,
          username: key.username,
          modelName: key.modelName,
          channelId: key.channelId,
        },
        dimensionHash: key.hash,
        metrics: { ...metrics },
      });
    }
  }
  return cells;
}

function maxBigIntNull(a: bigint | null, b: bigint | null): bigint | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

function maxStringNull(a: string | null, b: string | null): string | null {
  if (a === null || a === "") return b === "" ? null : b;
  if (b === null || b === "") return a;
  return a >= b ? a : b;
}

function mergeMetrics(
  into: DashboardRollupMetricTotals,
  add: DashboardRollupMetricTotals,
): DashboardRollupMetricTotals {
  return {
    requestCount: into.requestCount + add.requestCount,
    inputTokens: into.inputTokens + add.inputTokens,
    outputTokens: into.outputTokens + add.outputTokens,
    cacheTokens: into.cacheTokens + add.cacheTokens,
    attemptCount: into.attemptCount + add.attemptCount,
    successCount: into.successCount + add.successCount,
    errorCount: into.errorCount + add.errorCount,
    firstTokenLatencySum: into.firstTokenLatencySum + add.firstTokenLatencySum,
    firstTokenLatencyCount: into.firstTokenLatencyCount + add.firstTokenLatencyCount,
    responseTimeSum: into.responseTimeSum + add.responseTimeSum,
    responseTimeCount: into.responseTimeCount + add.responseTimeCount,
    outputTokensPerSecSum: into.outputTokensPerSecSum + add.outputTokensPerSecSum,
    outputTokensPerSecCount: into.outputTokensPerSecCount + add.outputTokensPerSecCount,
    firstUsedAt: Math.min(into.firstUsedAt, add.firstUsedAt),
    latestUsedAt: Math.max(into.latestUsedAt, add.latestUsedAt),
    representativeUserId: maxBigIntNull(into.representativeUserId, add.representativeUserId),
    representativeUsername: maxStringNull(
      into.representativeUsername,
      add.representativeUsername,
    ),
    representativeChannelName: maxStringNull(
      into.representativeChannelName,
      add.representativeChannelName,
    ),
  };
}

function cellMergeKey(
  cell: PendingDashboardRollupCell,
  hashFn: DashboardDimensionHashFn = hashDashboardDimensionKey,
): string {
  const hash = cell.dimensionHash ?? hashFn(cell.dimension);
  return `${hash.toString("hex")}|${cell.grain}|${cell.bucketStart}`;
}

/**
 * Accumulate already-normalized rows into dimensions + cells.
 * `hashFn` is production-generic (defaults to SHA-256) so callers/tests can inject
 * an alternate deterministic hash without a test-only API surface.
 */
export function accumulateNormalizedDashboardRows(
  rows: NormalizedDashboardLog[],
  hashFn: DashboardDimensionHashFn = hashDashboardDimensionKey,
): {
  dimensions: HashedDashboardDimensionKey[];
  cells: PendingDashboardRollupCell[];
  malformedOtherRows: number;
} {
  const dimensionByHash = new Map<string, HashedDashboardDimensionKey>();
  const cellByKey = new Map<string, PendingDashboardRollupCell>();
  let malformedOtherRows = 0;

  for (const normalized of rows) {
    if (normalized.malformedOther) malformedOtherRows += 1;
    const keys = buildDashboardDimensionKeys(normalized, hashFn);
    for (const key of keys) {
      const hex = key.hash.toString("hex");
      const existingKey = dimensionByHash.get(hex);
      if (!existingKey) {
        dimensionByHash.set(hex, key);
      } else {
        // Fatal hash collision: refuse to merge mismatched stored key values.
        assertDimensionKeyMatchesStored(key, existingKey);
      }
    }
    const emitted = emitDashboardRollupCells(normalized, keys, hashFn);
    for (const cell of emitted) {
      const mergeKey = cellMergeKey(cell, hashFn);
      const existing = cellByKey.get(mergeKey);
      if (!existing) {
        cellByKey.set(mergeKey, {
          ...cell,
          metrics: { ...cell.metrics },
        });
      } else {
        existing.metrics = mergeMetrics(existing.metrics, cell.metrics);
      }
    }
  }

  return {
    dimensions: [...dimensionByHash.values()],
    cells: [...cellByKey.values()],
    malformedOtherRows,
  };
}

export function accumulateDashboardRollupRows(
  rows: DashboardSourceLogRow[],
  formula?: DashboardRollupFormula,
  hashFn: DashboardDimensionHashFn = hashDashboardDimensionKey,
): {
  dimensions: HashedDashboardDimensionKey[];
  cells: PendingDashboardRollupCell[];
  malformedOtherRows: number;
} {
  const active = formula ?? getDashboardRollupFormula(DASHBOARD_ROLLUP_VERSION);
  const normalizedRows = rows.map((source) => active.normalize(source));
  return accumulateNormalizedDashboardRows(normalizedRows, hashFn);
}
