import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AuthFile } from "../../types/auth.ts";

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
    refresh_token: stringValue(auth?.refresh_token) || undefined,
    project_id: projectId || undefined,
    name: `${provider}-${user || id}`,
    type: provider,
    provider,
    authIndex: accountIndex(id),
    planType: stringValue(login.plan) || undefined,
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
