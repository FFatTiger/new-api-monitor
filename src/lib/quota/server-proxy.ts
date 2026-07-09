import type { RawAuthFile } from "./auth-files.ts";

import { extractProjectId, normalizeAuthIndex } from "./auth-files.ts";
import { parseIdTokenPayload } from "./parse-id-token.ts";
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  KIMI_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  resolveProviderType,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_REQUEST_HEADERS,
} from "./upstream.ts";

export type QuotaProxyAction =
  | "quota"
  | "antigravity-project-id"
  | "claude-usage"
  | "claude-profile"
  | "gemini-cli-quota"
  | "gemini-cli-code-assist"
  | "xai-weekly"
  | "xai-monthly";

export type QuotaProxyRequest = {
  authIndex?: unknown;
  provider?: unknown;
  action?: unknown;
};

export type BackendApiCall = {
  authIndex: string;
  method: "GET" | "POST";
  url: string;
  header: Record<string, string>;
  data?: string;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getFileSecretRecord(file: RawAuthFile) {
  const metadata = file.metadata as Record<string, unknown> | undefined;
  const attributes = file.attributes as Record<string, unknown> | undefined;
  return { metadata, attributes };
}

function getFileIdToken(file: RawAuthFile) {
  const { metadata, attributes } = getFileSecretRecord(file);
  return file.id_token ?? metadata?.id_token ?? attributes?.id_token;
}

function getCodexAccountId(file: RawAuthFile): string {
  const payload = parseIdTokenPayload(getFileIdToken(file));
  const accountId = payload?.chatgpt_account_id || payload?.chatgptAccountId;
  if (typeof accountId === "string" && accountId.trim()) {
    return accountId.trim();
  }

  throw new Error("Missing Codex account id");
}

function getGeminiProjectId(file: RawAuthFile): string {
  const { metadata, attributes } = getFileSecretRecord(file);
  const account = metadata?.account ?? attributes?.account;
  if (typeof account !== "string") {
    throw new Error("Missing Gemini project id");
  }

  const matches = Array.from(account.matchAll(/\(([^()]+)\)/g));
  const candidate = matches[matches.length - 1]?.[1]?.trim();
  if (candidate) {
    return candidate;
  }

  throw new Error("Missing Gemini project id");
}

function getRequestedProvider(request: QuotaProxyRequest) {
  return stringValue(request.provider)?.toLowerCase() ?? "";
}

function getRequestedAction(request: QuotaProxyRequest): QuotaProxyAction {
  const action = stringValue(request.action);
  if (
    action === "quota" ||
    action === "antigravity-project-id" ||
    action === "claude-usage" ||
    action === "claude-profile" ||
    action === "gemini-cli-quota" ||
    action === "gemini-cli-code-assist" ||
    action === "xai-weekly" ||
    action === "xai-monthly"
  ) {
    return action;
  }

  return "quota";
}

function assertProviderMatchesRequest(file: RawAuthFile, request: QuotaProxyRequest) {
  const requestedProvider = getRequestedProvider(request);
  const actualProvider = resolveProviderType(file);

  if (!requestedProvider || requestedProvider !== actualProvider) {
    throw new Error("Provider mismatch");
  }

  return actualProvider;
}

export function findRawAuthFile(files: RawAuthFile[], authIndex: unknown): RawAuthFile {
  const requestedAuthIndex = normalizeAuthIndex(authIndex);
  if (!requestedAuthIndex) {
    throw new Error("Missing auth index");
  }

  const file = files.find((candidate) => normalizeAuthIndex(candidate.authIndex ?? candidate.auth_index) === requestedAuthIndex);
  if (!file) {
    throw new Error("Unknown auth index");
  }

  return file;
}

export function buildQuotaApiCall(
  request: QuotaProxyRequest,
  file: RawAuthFile,
  fileContent: Record<string, unknown> | null = null,
): BackendApiCall {
  const provider = assertProviderMatchesRequest(file, request);
  const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
  const action = getRequestedAction(request);

  if (provider === "antigravity") {
    if (action !== "quota" && action !== "antigravity-project-id") {
      throw new Error("Unsupported quota action");
    }

    const projectId = fileContent ? extractProjectId(fileContent) : null;
    const project = projectId || "bamboo-precept-lgxtn";
    return {
      authIndex,
      method: "POST",
      url: ANTIGRAVITY_QUOTA_URLS[0],
      header: { ...ANTIGRAVITY_REQUEST_HEADERS },
      data: action === "antigravity-project-id" ? JSON.stringify({ projectId: project }) : JSON.stringify({ project }),
    };
  }

  if (provider === "claude") {
    if (action !== "claude-usage" && action !== "claude-profile" && action !== "quota") {
      throw new Error("Unsupported quota action");
    }

    return {
      authIndex,
      method: "GET",
      url: action === "claude-profile" ? CLAUDE_PROFILE_URL : CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    };
  }

  if (provider === "codex") {
    if (action !== "quota") {
      throw new Error("Unsupported quota action");
    }

    return {
      authIndex,
      method: "GET",
      url: CODEX_USAGE_URL,
      header: {
        ...CODEX_REQUEST_HEADERS,
        "Chatgpt-Account-Id": getCodexAccountId(file),
      },
    };
  }

  if (provider === "gemini-cli") {
    if (action !== "gemini-cli-quota" && action !== "gemini-cli-code-assist" && action !== "quota") {
      throw new Error("Unsupported quota action");
    }

    const project = getGeminiProjectId(file);
    if (action === "gemini-cli-code-assist") {
      return {
        authIndex,
        method: "POST",
        url: GEMINI_CLI_CODE_ASSIST_URL,
        header: { ...GEMINI_CLI_REQUEST_HEADERS },
        data: JSON.stringify({
          cloudaicompanionProject: project,
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
            duetProject: project,
          },
        }),
      };
    }

    return {
      authIndex,
      method: "POST",
      url: GEMINI_CLI_QUOTA_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({ project }),
    };
  }

  if (provider === "kimi") {
    if (action !== "quota") {
      throw new Error("Unsupported quota action");
    }

    return {
      authIndex,
      method: "GET",
      url: KIMI_USAGE_URL,
      header: { ...KIMI_REQUEST_HEADERS },
    };
  }

  if (provider === "xai") {
    if (action !== "quota" && action !== "xai-weekly" && action !== "xai-monthly") {
      throw new Error("Unsupported quota action");
    }

    return {
      authIndex,
      method: "GET",
      url: action === "xai-monthly" ? XAI_BILLING_MONTHLY_URL : XAI_BILLING_WEEKLY_URL,
      header: { ...XAI_REQUEST_HEADERS },
    };
  }

  throw new Error("Unsupported provider");
}
