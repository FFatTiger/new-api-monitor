import type { AuthFile } from "../../types/auth.ts";

import {
  buildMiniMaxAuthFile,
  buildZaiAuthFile,
  extractProjectId,
  sanitizeAuthFile,
  type RawAuthFile,
} from "./auth-files.ts";
import { fetchSub2ApiCredentialFiles, getSub2ApiConfig, type Sub2ApiConfig } from "./sub2api.ts";
import { getZaiApiKeysFromEnv } from "./zai.ts";

export type QuotaServerConfig = {
  apiBaseUrl: string;
  apiManagementKey: string;
  zaiApiKeys: string[];
  miniMaxApiKey: string;
  miniMaxApiRegion: string;
  miniMaxApiBaseUrl: string;
  sub2api: Sub2ApiConfig;
};

export type ServerAuthFileList = {
  files: AuthFile[];
  /** Server-only credential records. Never serialize this field to a route response. */
  rawFiles: RawAuthFile[];
  config: QuotaServerConfig;
};

export function getQuotaServerConfig(env: NodeJS.ProcessEnv = process.env): QuotaServerConfig {
  return {
    apiBaseUrl: (env.API_BASE_URL || "").replace(/\/+$/, ""),
    apiManagementKey: env.API_MANAGEMENT_KEY || "",
    zaiApiKeys: getZaiApiKeysFromEnv(env),
    miniMaxApiKey: env.MINIMAX_API_KEY || env.MINIMAX_API_TOKEN || "",
    miniMaxApiRegion: env.MINIMAX_API_REGION || "auto",
    miniMaxApiBaseUrl: env.MINIMAX_API_BASE_URL || "",
    sub2api: getSub2ApiConfig(env),
  };
}

export function buildRuntimeAuthFiles(config: Pick<QuotaServerConfig, "zaiApiKeys" | "miniMaxApiKey" | "miniMaxApiRegion">): AuthFile[] {
  const zaiFiles = config.zaiApiKeys.map((apiKey, slot) => buildZaiAuthFile(apiKey, slot, config.zaiApiKeys.length));
  return [...zaiFiles, buildMiniMaxAuthFile(config.miniMaxApiKey, config.miniMaxApiRegion)].filter(
    (file): file is NonNullable<typeof file> => Boolean(file),
  );
}

export async function fetchBackendAuthFiles(config: QuotaServerConfig, fetchImpl: typeof fetch = fetch): Promise<RawAuthFile[]> {
  const response = await fetchImpl(`${config.apiBaseUrl}/auth-files`, {
    headers: { Authorization: `Bearer ${config.apiManagementKey}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Backend request failed: ${response.status}`);
  const data = (await response.json()) as { files?: RawAuthFile[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function fetchBackendAuthFileContent(name: string, config: QuotaServerConfig, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(`${config.apiBaseUrl}/auth-files/download?name=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${config.apiManagementKey}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const value = JSON.parse((await response.text()).trim());
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function listServerAuthFiles(fetchImpl: typeof fetch = fetch): Promise<ServerAuthFileList> {
  const config = getQuotaServerConfig();
  const runtimeFiles = buildRuntimeAuthFiles(config);
  const hasCpa = Boolean(config.apiBaseUrl && config.apiManagementKey);

  const [cpaResult, sub2Result] = await Promise.allSettled([
    hasCpa ? fetchBackendAuthFiles(config, fetchImpl) : Promise.resolve([] as RawAuthFile[]),
    fetchSub2ApiCredentialFiles(config.sub2api, fetchImpl),
  ]);

  if (cpaResult.status === "rejected" && !runtimeFiles.length && sub2Result.status === "rejected") {
    throw cpaResult.reason;
  }
  if (cpaResult.status === "rejected") console.error("Failed to list CPA auth files", cpaResult.reason);
  if (sub2Result.status === "rejected") console.error("Failed to list Sub2API accounts", sub2Result.reason);

  const cpaFiles = cpaResult.status === "fulfilled" ? cpaResult.value : [];
  const cpaAccounts = await Promise.all(cpaFiles.map(async (file) => {
    const content = await fetchBackendAuthFileContent(file.name, config, fetchImpl);
    const type = String(file.type || file.provider || "").toLowerCase();
    const projectId = type.includes("antigravity") && content ? extractProjectId(content) || "bamboo-precept-lgxtn" : null;
    // List metadata owns the public identity; downloaded JSON only supplies credentials.
    const credentialFile: RawAuthFile = { ...content, ...file };
    return { file: sanitizeAuthFile(file, projectId), raw: credentialFile };
  }));
  const sub2 = sub2Result.status === "fulfilled" ? sub2Result.value : { files: [], rawFiles: [] };

  return {
    files: [...cpaAccounts.map((account) => account.file), ...sub2.files, ...runtimeFiles],
    rawFiles: [...cpaAccounts.map((account) => account.raw), ...sub2.rawFiles],
    config,
  };
}
