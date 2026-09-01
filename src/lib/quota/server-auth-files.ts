import type { AuthFile } from "../../types/auth.ts";

import {
  buildMiniMaxAuthFile,
  buildZaiAuthFile,
  extractProjectId,
  sanitizeAuthFile,
  type RawAuthFile,
} from "./auth-files.ts";
import { getZaiApiKeysFromEnv } from "./zai.ts";

export type QuotaServerConfig = {
  apiBaseUrl: string;
  apiManagementKey: string;
  zaiApiKeys: string[];
  miniMaxApiKey: string;
  miniMaxApiRegion: string;
  miniMaxApiBaseUrl: string;
};

export type ServerAuthFileList = {
  files: AuthFile[];
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
  };
}

export function buildRuntimeAuthFiles(config: Pick<QuotaServerConfig, "zaiApiKeys" | "miniMaxApiKey" | "miniMaxApiRegion">): AuthFile[] {
  const zaiFiles = config.zaiApiKeys.map((apiKey, slot) =>
    buildZaiAuthFile(apiKey, slot, config.zaiApiKeys.length),
  );

  return [
    ...zaiFiles,
    buildMiniMaxAuthFile(config.miniMaxApiKey, config.miniMaxApiRegion),
  ].filter((file): file is NonNullable<typeof file> => Boolean(file));
}

export async function fetchBackendAuthFiles(config: QuotaServerConfig, fetchImpl: typeof fetch = fetch): Promise<RawAuthFile[]> {
  const response = await fetchImpl(`${config.apiBaseUrl}/auth-files`, {
    headers: {
      Authorization: `Bearer ${config.apiManagementKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  const data = (await response.json()) as { files?: RawAuthFile[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function fetchBackendAuthFileContent(
  name: string,
  config: QuotaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(`${config.apiBaseUrl}/auth-files/download?name=${encodeURIComponent(name)}`, {
      headers: {
        Authorization: `Bearer ${config.apiManagementKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;
    return JSON.parse((await response.text()).trim());
  } catch {
    return null;
  }
}

export async function listServerAuthFiles(fetchImpl: typeof fetch = fetch): Promise<ServerAuthFileList> {
  const config = getQuotaServerConfig();
  const runtimeFiles = buildRuntimeAuthFiles(config);

  if (!config.apiBaseUrl || !config.apiManagementKey) {
    if (runtimeFiles.length) {
      return { files: runtimeFiles, rawFiles: [], config };
    }

    throw new Error("Server configuration missing");
  }

  const rawFiles = await fetchBackendAuthFiles(config, fetchImpl);
  const sanitizedFiles = await Promise.all(
    rawFiles.map(async (file) => {
      const type = String(file.type || file.provider || "").toLowerCase();
      const isAntigravity = type.includes("antigravity");

      let projectId: string | null = null;
      if (isAntigravity) {
        const content = await fetchBackendAuthFileContent(file.name, config, fetchImpl);
        projectId = content ? extractProjectId(content) || "bamboo-precept-lgxtn" : "bamboo-precept-lgxtn";
      }

      return sanitizeAuthFile(file, projectId);
    }),
  );

  return { files: [...sanitizedFiles, ...runtimeFiles], rawFiles, config };
}
