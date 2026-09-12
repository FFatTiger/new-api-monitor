import type { AuthFile } from "../../types/auth.ts";

import { sanitizeAuthFile, type RawAuthFile } from "./auth-files.ts";
import { resolveProviderType } from "./upstream.ts";

export type Sub2ApiConfig = {
  baseUrl: string;
  email: string;
  password: string;
  providerMap: Record<string, string>;
};

type Sub2ApiEnvelope<T> = { code?: number; message?: string; data?: T };

type Sub2ApiAccount = {
  id?: number | string;
  name?: string;
  platform?: string;
  status?: string;
};

type Sub2ApiExport = {
  accounts?: Array<{
    credentials?: Record<string, unknown>;
  }>;
};

export type Sub2ApiCredentialFile = RawAuthFile & {
  source: "sub2api";
  sourceAccountId: string;
};

function normalizeBaseUrl(value: unknown) {
  const base = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!base) return "";
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

export type Sub2ApiEnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

function parseProviderMap(value: unknown) {
  const map: Record<string, string> = {};
  if (typeof value !== "string") return map;
  value.split(/[,，]/).forEach((entry) => {
    const [source, target] = entry.split(/=|:/, 2).map((part) => part.trim().toLowerCase());
    if (source && target && resolveProviderType({ type: target }) !== "unknown") map[source] = target;
  });
  return map;
}

export function getSub2ApiConfig(env: Sub2ApiEnvSource = process.env): Sub2ApiConfig {
  return {
    baseUrl: normalizeBaseUrl(env.SUB2API_BASE_URL),
    email: (env.SUB2API_EMAIL || "").trim(),
    password: env.SUB2API_PASSWORD || "",
    providerMap: parseProviderMap(env.SUB2API_PROVIDER_MAP),
  };
}

export function isSub2ApiConfigured(config: Sub2ApiConfig) {
  return Boolean(config.baseUrl && config.email && config.password);
}

function mapPlatform(platform: unknown, customMap: Record<string, string>): string | null {
  const value = typeof platform === "string" ? platform.trim().toLowerCase() : "";
  const custom = customMap[value];
  if (custom) return custom;
  const shared = resolveProviderType({ type: value });
  if (shared !== "unknown") return shared;
  if (value === "openai") return "codex";
  if (value === "zhipu") return "zai";
  return null;
}

function accountIndex(id: string) {
  return `sub2api-account-${id}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as Sub2ApiEnvelope<T>;
  if (!response.ok || body.code !== undefined && body.code !== 0) {
    throw new Error(body.message || `Sub2API request failed: HTTP ${response.status}`);
  }
  if (body.data === undefined) throw new Error("Sub2API returned no data");
  return body.data;
}

async function login(config: Sub2ApiConfig, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await responseJson<{ access_token?: string }>(response);
  if (!data.access_token) throw new Error("Sub2API login returned no access token");
  return data.access_token;
}

/**
 * Exports one account at a time because Sub2API's credential export omits the
 * source ID from returned account objects. Credentials never leave this module.
 */
export async function fetchSub2ApiCredentialFiles(
  config: Sub2ApiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ files: AuthFile[]; rawFiles: Sub2ApiCredentialFile[] }> {
  if (!isSub2ApiConfigured(config)) return { files: [], rawFiles: [] };

  const token = await login(config, fetchImpl);
  const headers = { Authorization: `Bearer ${token}` };
  const accountsResponse = await fetchImpl(`${config.baseUrl}/admin/accounts?page=1&page_size=1000`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const listed = await responseJson<{ items?: Sub2ApiAccount[] }>(accountsResponse);
  const accounts = Array.isArray(listed.items) ? listed.items : [];
  const candidates = accounts
    .map((account) => ({ account, id: String(account.id ?? "").trim(), provider: mapPlatform(account.platform, config.providerMap) }))
    .filter((entry): entry is { account: Sub2ApiAccount; id: string; provider: string } => Boolean(entry.id && entry.provider));

  const results = await Promise.all(
    candidates.map(async ({ account, id, provider }) => {
      const exportResponse = await fetchImpl(
        `${config.baseUrl}/admin/accounts/data?ids=${encodeURIComponent(id)}&include_proxies=false`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) },
      );
      const exported = await responseJson<Sub2ApiExport>(exportResponse);
      const credentials = exported.accounts?.[0]?.credentials;
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
        throw new Error(`Sub2API account ${id} returned no credentials`);
      }

      const raw: Sub2ApiCredentialFile = {
        ...credentials,
        name: `${provider}-${account.name || id}`,
        type: provider,
        provider,
        authIndex: accountIndex(id),
        status_message: account.status && account.status !== "active" ? `Sub2API: ${account.status}` : undefined,
        source: "sub2api",
        sourceAccountId: id,
      };
      const file = sanitizeAuthFile(raw, null);
      return { file, raw };
    }),
  );

  return { files: results.map((result) => result.file), rawFiles: results.map((result) => result.raw) };
}

export function isSub2ApiAuthIndex(value: unknown) {
  return /^sub2api-account-[1-9][0-9]*$/.test(String(value ?? "").trim());
}
