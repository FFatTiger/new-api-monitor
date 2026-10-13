import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AuthFile } from "../../types/auth.ts";
import type { QuotaData } from "../../types/quota.ts";

import { sanitizeAuthFile, type RawAuthFile } from "./auth-files.ts";
import { resolveProviderType } from "./upstream.ts";

export type MagpieCredentialFile = RawAuthFile & {
  source: "magpie";
  sourceAccountId: string;
};

type MagpieLogin = {
  id?: unknown;
  agent?: unknown;
  user?: unknown;
  plan?: unknown;
  on?: unknown;
  auth?: unknown;
  project?: unknown;
};

function accountIndex(id: string) {
  return `magpie-${id}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function magpieCredentialFile(login: MagpieLogin): { file: AuthFile; raw: MagpieCredentialFile } | null {
  if (login.on === false) return null;
  const id = stringValue(login.id);
  const provider = resolveProviderType({ type: stringValue(login.agent) });
  const auth = recordValue(login.auth);
  const accessToken = stringValue(auth?.access_token);
  if (!id || provider === "unknown" || !accessToken) return null;

  const projectId = stringValue(auth?.project) || stringValue(login.project);
  const user = stringValue(login.user);
  const raw: MagpieCredentialFile = {
    access_token: accessToken,
    project_id: projectId || undefined,
    name: `${provider}-${user || id}`,
    type: provider,
    provider,
    authIndex: accountIndex(id),
    planType: stringValue(login.plan) || undefined,
    user,
    source: "magpie",
    sourceAccountId: id,
  };
  return { file: sanitizeAuthFile(raw, projectId || null), raw };
}

export async function readMagpieCredentialFiles(
  configDir: string,
): Promise<{ files: AuthFile[]; rawFiles: MagpieCredentialFile[] }> {
  const root = configDir.trim();
  if (!root) return { files: [], rawFiles: [] };

  const payload = JSON.parse(await readFile(path.join(root, "logins.json"), "utf8")) as unknown;
  const logins = Array.isArray(payload) ? payload : [];
  const results = logins
    .map((login) => magpieCredentialFile(recordValue(login) ?? {}))
    .filter((result): result is NonNullable<typeof result> => Boolean(result));
  return { files: results.map((result) => result.file), rawFiles: results.map((result) => result.raw) };
}

export function getMagpieConfigDir(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
  return (env.MAGPIE_CONFIG_DIR || "").trim();
}

type MagpieQuotaCard = {
  provider?: unknown;
  user?: unknown;
  windows?: unknown;
};

type MagpieQuotaWindow = {
  name?: unknown;
  pool?: unknown;
  used?: unknown;
  resetsAt?: unknown;
};

export function magpieQuotaData(cards: unknown, provider: string, user: string): QuotaData {
  const account = (Array.isArray(cards) ? cards as MagpieQuotaCard[] : []).find((card) => {
    return stringValue(card.provider).toLowerCase() === provider.toLowerCase() && stringValue(card.user).toLowerCase() === user.toLowerCase();
  });
  const windows = Array.isArray(account?.windows) ? account.windows as MagpieQuotaWindow[] : [];
  const groups = windows.flatMap((windowInfo) => {
    const pool = stringValue(windowInfo.pool);
    const name = stringValue(windowInfo.name);
    const used = typeof windowInfo.used === "number" ? windowInfo.used : Number.NaN;
    if (!pool || !name || !Number.isFinite(used)) return [];
    const label = `${pool} \u00b7 ${name}`;
    const resetTime = stringValue(windowInfo.resetsAt);
    return [{
      id: label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""),
      label,
      models: [],
      remainingFraction: (100 - used) / 100,
      resetTime: resetTime || undefined,
    }];
  });
  if (!groups.length) throw new Error("Magpie has not read this account's quota");
  return { groups };
}
