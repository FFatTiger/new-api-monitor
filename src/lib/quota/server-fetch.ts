import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData } from "../../types/quota.ts";

import type { RawAuthFile } from "./auth-files.ts";
import { buildKimiQuotaRows } from "./kimi.ts";
import {
  buildMiniMaxQuotaData,
  getMiniMaxEndpointCandidates,
  getMiniMaxStatusCode,
  getMiniMaxStatusMessage,
  normalizeMiniMaxApiKey,
  normalizeMiniMaxRegion,
} from "./minimax.ts";
import {
  buildQuotaApiCall,
  findRawAuthFile,
  type QuotaProxyAction,
  type QuotaProxyRequest,
} from "./server-proxy.ts";
import type { QuotaServerConfig } from "./server-auth-files.ts";
import { buildGrokQuotaDataFromApiCallResults } from "./grok.ts";
import {
  buildAntigravityQuotaGroups,
  buildClaudeQuotaWindows,
  buildCodexQuotaWindows,
  buildGeminiCliQuotaBuckets,
  getApiCallErrorMessage,
  normalizeApiCallEnvelope,
  normalizeCodexPlanType,
  normalizeNumberValue,
  normalizeStringValue,
  parseJsonMaybe,
  resolveClaudePlanType,
  resolveProviderType,
} from "./upstream.ts";
import { buildZaiQuotaData, ZAI_USAGE_URL } from "./zai.ts";

export type ServerQuotaFetchContext = {
  config: QuotaServerConfig;
  rawFiles: RawAuthFile[];
  fetchFileContent?: (name: string) => Promise<Record<string, unknown> | null>;
  fetchImpl?: typeof fetch;
};

function ensureRecord(value: unknown, message = "No quota data available") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function ensureSuccessfulEnvelope(value: unknown) {
  const envelope = normalizeApiCallEnvelope(value);
  if (envelope.statusCode < 200 || envelope.statusCode >= 300) {
    throw new Error(`API Error ${getApiCallErrorMessage(envelope)}`);
  }
  return envelope;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function callManagedQuotaApi(request: QuotaProxyRequest, context: ServerQuotaFetchContext) {
  if (!context.config.apiBaseUrl || !context.config.apiManagementKey) {
    throw new Error("Server configuration missing");
  }

  const rawFile = findRawAuthFile(context.rawFiles, request.authIndex);
  const provider = resolveProviderType(rawFile);
  const fileContent = provider === "antigravity" && context.fetchFileContent ? await context.fetchFileContent(rawFile.name) : null;
  const apiCall = buildQuotaApiCall(request, rawFile, fileContent);
  const response = await (context.fetchImpl || fetch)(`${context.config.apiBaseUrl}/api-call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.config.apiManagementKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(apiCall),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return normalizeApiCallEnvelope(await response.json());
}

function codexPlanType(file: AuthFile, payload: Record<string, unknown>) {
  return (
    normalizeCodexPlanType(payload.plan_type ?? payload.planType) ??
    normalizeCodexPlanType(file.planType ?? file.plan_type)
  );
}

async function fetchManagedProviderAction(
  file: AuthFile,
  provider: Exclude<ReturnType<typeof resolveProviderType>, "unknown" | "xai" | "zai" | "minimax">,
  context: ServerQuotaFetchContext,
  action?: QuotaProxyAction,
) {
  return callManagedQuotaApi({ authIndex: file.authIndex, provider, action }, context);
}

async function fetchCodexQuotaOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  const envelope = ensureSuccessfulEnvelope(await fetchManagedProviderAction(file, "codex", context));
  const payload = ensureRecord(parseJsonMaybe(envelope.body ?? envelope.bodyText));
  const planType = codexPlanType(file, payload);

  return {
    ...payload,
    planType: planType ?? undefined,
    plan_type: normalizeStringValue(payload.plan_type ?? payload.planType) ?? planType ?? undefined,
    windows: buildCodexQuotaWindows(payload).map((windowData) => ({
      ...windowData,
      usedPercent: windowData.usedPercent ?? undefined,
      remainingPercent: windowData.remainingPercent ?? null,
    })),
  };
}

async function fetchClaudeQuotaOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  const [usageResult, profileResult] = await Promise.allSettled([
    fetchManagedProviderAction(file, "claude", context, "claude-usage"),
    fetchManagedProviderAction(file, "claude", context, "claude-profile"),
  ]);

  if (usageResult.status === "rejected") {
    throw usageResult.reason;
  }

  const usageEnvelope = ensureSuccessfulEnvelope(usageResult.value);
  const payload = ensureRecord(parseJsonMaybe(usageEnvelope.body ?? usageEnvelope.bodyText));
  const profile =
    profileResult.status === "fulfilled" &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? parseJsonMaybe(profileResult.value.body ?? profileResult.value.bodyText)
      : null;

  return {
    windows: buildClaudeQuotaWindows(payload).map((windowData) => ({
      ...windowData,
      usedPercent: windowData.usedPercent ?? undefined,
      remainingPercent: windowData.remainingPercent ?? null,
    })),
    extra_usage: optionalRecord(payload.extra_usage),
    planType: resolveClaudePlanType(profile) ?? undefined,
  };
}

async function fetchGeminiCliCodeAssistOnServer(file: AuthFile, context: ServerQuotaFetchContext) {
  try {
    const result = await fetchManagedProviderAction(file, "gemini-cli", context, "gemini-cli-code-assist");
    if (result.statusCode < 200 || result.statusCode >= 300) return {};

    const payload = parseJsonMaybe(result.body ?? result.bodyText);
    const data = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const currentTier = data.currentTier || data.current_tier;
    const paidTier = data.paidTier || data.paid_tier;
    const tier = paidTier && typeof paidTier === "object" ? paidTier : currentTier;
    const tierRecord = tier && typeof tier === "object" && !Array.isArray(tier) ? (tier as Record<string, unknown>) : {};
    const rawTierId = normalizeStringValue(tierRecord.id);
    const credits = tierRecord.availableCredits || tierRecord.available_credits;
    let creditBalance: number | null = null;

    if (Array.isArray(credits)) {
      for (const credit of credits) {
        const record = credit && typeof credit === "object" && !Array.isArray(credit) ? (credit as Record<string, unknown>) : {};
        const creditType = normalizeStringValue(record.creditType ?? record.credit_type);
        if (creditType !== "GOOGLE_ONE_AI") continue;
        const amount = normalizeNumberValue(record.creditAmount ?? record.credit_amount);
        if (amount !== null) {
          creditBalance = (creditBalance ?? 0) + amount;
        }
      }
    }

    return {
      tierId: rawTierId?.toLowerCase() ?? null,
      tierLabel: rawTierId ?? null,
      creditBalance,
    };
  } catch {
    return {};
  }
}

async function fetchGeminiCliQuotaOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  const envelope = ensureSuccessfulEnvelope(await fetchManagedProviderAction(file, "gemini-cli", context, "gemini-cli-quota"));
  const payload = ensureRecord(parseJsonMaybe(envelope.body ?? envelope.bodyText));
  const buckets = Array.isArray(payload.buckets)
    ? buildGeminiCliQuotaBuckets(payload.buckets).map((bucket) => ({
        ...bucket,
        remainingFraction: bucket.remainingFraction ?? undefined,
        remainingAmount: bucket.remainingAmount ?? null,
      }))
    : [];
  const supplementary = await fetchGeminiCliCodeAssistOnServer(file, context);

  return { ...payload, buckets, ...supplementary };
}

async function fetchKimiQuotaOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  const envelope = ensureSuccessfulEnvelope(await fetchManagedProviderAction(file, "kimi", context));
  const payload = ensureRecord(parseJsonMaybe(envelope.body ?? envelope.bodyText));
  const rows = buildKimiQuotaRows(payload);
  if (!rows.length) throw new Error("No quota data available");
  return { rows };
}

async function fetchGrokQuotaOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  const rawFile = findRawAuthFile(context.rawFiles, file.authIndex);
  if (resolveProviderType(rawFile) !== "xai") {
    throw new Error("Provider mismatch");
  }

  const [weeklyResult, monthlyResult] = await Promise.allSettled([
    callManagedQuotaApi({ authIndex: file.authIndex, provider: "xai", action: "xai-weekly" }, context),
    callManagedQuotaApi({ authIndex: file.authIndex, provider: "xai", action: "xai-monthly" }, context),
  ]);

  return buildGrokQuotaDataFromApiCallResults(weeklyResult, monthlyResult);
}

async function fetchAntigravityQuotaOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const envelope = await fetchManagedProviderAction(
        file,
        "antigravity",
        context,
        attempt === 0 ? "quota" : "antigravity-project-id",
      );

      if (envelope.statusCode < 200 || envelope.statusCode >= 300) {
        const errorMessage = getApiCallErrorMessage(envelope);
        lastError = errorMessage;

        if (envelope.statusCode === 400) {
          const normalizedError = String(errorMessage).toLowerCase();
          if (normalizedError.includes("unknown name") && normalizedError.includes("cannot find field") && attempt < 1) {
            continue;
          }
        }

        if (envelope.statusCode === 403 || envelope.statusCode === 404) {
          break;
        }

        continue;
      }

      const body = parseJsonMaybe(envelope.body ?? envelope.bodyText);
      const payload =
        body && typeof body === "object" && !Array.isArray(body) && "models" in body
          ? (body as Record<string, unknown>)
          : body && typeof body === "object" && !Array.isArray(body) && "body" in body
            ? (parseJsonMaybe((body as Record<string, unknown>).body) as Record<string, unknown> | null)
            : null;
      const models = payload?.models;

      if (!models || typeof models !== "object" || Array.isArray(models)) {
        lastError = "No quota data available";
        continue;
      }

      return {
        ...payload,
        groups: buildAntigravityQuotaGroups(models as Parameters<typeof buildAntigravityQuotaGroups>[0]),
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "Failed to fetch Antigravity quota");
}

async function fetchZaiQuotaOnServer(context: ServerQuotaFetchContext): Promise<QuotaData> {
  if (!context.config.zaiApiKey) throw new Error("Server configuration missing");

  const response = await (context.fetchImpl || fetch)(ZAI_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${context.config.zaiApiKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Backend request failed: ${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.success === false) {
    throw new Error(normalizeStringValue(payload.msg) || "Z.ai quota request failed");
  }

  const data = buildZaiQuotaData(payload);
  if (!data.windows?.length) throw new Error("No quota data available");
  return data;
}

async function fetchMiniMaxQuotaOnServer(context: ServerQuotaFetchContext): Promise<QuotaData> {
  const apiKey = normalizeMiniMaxApiKey(context.config.miniMaxApiKey);
  if (!apiKey) throw new Error("Server configuration missing");

  const endpoints = getMiniMaxEndpointCandidates(
    normalizeMiniMaxRegion(context.config.miniMaxApiRegion),
    context.config.miniMaxApiBaseUrl,
  );
  let lastPayload: Record<string, unknown> | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await (context.fetchImpl || fetch)(endpoint.url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) {
        lastPayload = {
          base_resp: { status_code: response.status, status_msg: `HTTP ${response.status}` },
          endpointRegion: endpoint.region,
        };
        continue;
      }

      const payload = { ...((await response.json()) as Record<string, unknown>), endpointRegion: endpoint.region };
      lastPayload = payload;
      const statusCode = getMiniMaxStatusCode(payload);
      if (statusCode === 0 || statusCode !== 1004 || endpoints.length === 1) {
        break;
      }
    } catch {
      lastPayload = {
        base_resp: { status_code: -1, status_msg: "request failed" },
        endpointRegion: endpoint.region,
      };
    }
  }

  if (!lastPayload) throw new Error("MiniMax quota request failed");
  const statusCode = getMiniMaxStatusCode(lastPayload);
  if (statusCode !== 0) {
    const statusMessage = getMiniMaxStatusMessage(lastPayload);
    throw new Error(`MiniMax API Error ${statusCode ?? "unknown"}${statusMessage ? `: ${statusMessage}` : ""}`);
  }

  const region = normalizeMiniMaxRegion(lastPayload.endpointRegion);
  const data = buildMiniMaxQuotaData(lastPayload, region === "cn" ? "cn" : "global");
  if (!data.windows?.length) throw new Error("No quota data available");
  return data;
}

export async function fetchQuotaForAuthFileOnServer(file: AuthFile, context: ServerQuotaFetchContext): Promise<QuotaData> {
  const provider = resolveProviderType(file);

  if (provider === "antigravity") return fetchAntigravityQuotaOnServer(file, context);
  if (provider === "claude") return fetchClaudeQuotaOnServer(file, context);
  if (provider === "codex") return fetchCodexQuotaOnServer(file, context);
  if (provider === "gemini-cli") return fetchGeminiCliQuotaOnServer(file, context);
  if (provider === "xai") return fetchGrokQuotaOnServer(file, context);
  if (provider === "kimi") return fetchKimiQuotaOnServer(file, context);
  if (provider === "minimax") return fetchMiniMaxQuotaOnServer(context);
  if (provider === "zai") return fetchZaiQuotaOnServer(context);

  throw new Error(`Unsupported provider: ${provider}`);
}
