export type OAuthProvider = "codex" | "anthropic" | "antigravity" | "gemini-cli" | "kimi" | "xai";
export type CallbackBackendProvider = "codex" | "anthropic" | "antigravity" | "gemini" | "xai";

const MAX_VERTEX_CREDENTIAL_FILE_SIZE = 256 * 1024;

const providerAliases: Record<string, OAuthProvider> = {
  claude: "anthropic",
  anthropic: "anthropic",
  codex: "codex",
  openai: "codex",
  antigravity: "antigravity",
  "anti-gravity": "antigravity",
  "gemini-cli": "gemini-cli",
  gemini: "gemini-cli",
  google: "gemini-cli",
  kimi: "kimi",
  xai: "xai",
  "x-ai": "xai",
  "x.ai": "xai",
  grok: "xai",
};

const startEndpointByProvider: Record<OAuthProvider, string> = {
  anthropic: "anthropic-auth-url",
  antigravity: "antigravity-auth-url",
  codex: "codex-auth-url",
  "gemini-cli": "gemini-cli-auth-url",
  kimi: "kimi-auth-url",
  xai: "xai-auth-url",
};

const callbackBackendProviderByProvider: Partial<Record<OAuthProvider, CallbackBackendProvider>> = {
  anthropic: "anthropic",
  antigravity: "antigravity",
  codex: "codex",
  "gemini-cli": "gemini",
  xai: "xai",
};

const webUiSupportedProviders = new Set<OAuthProvider>(["anthropic", "antigravity", "codex", "gemini-cli", "xai"]);

export function normalizeOAuthProvider(provider: unknown): OAuthProvider | null {
  if (typeof provider !== "string") return null;
  const key = provider.trim().toLowerCase();
  if (!key) return null;
  return providerAliases[key] ?? null;
}

export function isOAuthProvider(provider: unknown): boolean {
  return normalizeOAuthProvider(provider) !== null;
}

export function assertOAuthProvider(provider: unknown): OAuthProvider {
  const normalized = normalizeOAuthProvider(provider);
  if (!normalized) {
    throw new Error("Invalid provider");
  }
  return normalized;
}

function normalizeBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, "");
}

export function buildOAuthStartBackendRequest(apiBaseUrl: string, provider: unknown, projectId?: unknown) {
  const normalizedProvider = assertOAuthProvider(provider);
  const params = new URLSearchParams();

  if (webUiSupportedProviders.has(normalizedProvider)) {
    params.set("is_webui", "true");
  }

  if (normalizedProvider === "gemini-cli" && typeof projectId === "string" && projectId.trim()) {
    params.set("project_id", projectId.trim());
  }

  const query = params.toString();
  const url = `${normalizeBaseUrl(apiBaseUrl)}/${startEndpointByProvider[normalizedProvider]}${query ? `?${query}` : ""}`;

  return { provider: normalizedProvider, url };
}

export function isCallbackSupportedProvider(provider: unknown): boolean {
  const normalized = normalizeOAuthProvider(provider);
  return Boolean(normalized && callbackBackendProviderByProvider[normalized]);
}

export function getCallbackBackendProvider(provider: unknown): CallbackBackendProvider {
  const normalizedProvider = assertOAuthProvider(provider);
  const backendProvider = callbackBackendProviderByProvider[normalizedProvider];
  if (!backendProvider) {
    throw new Error("Provider does not support callback submission");
  }
  return backendProvider;
}

export function hasOAuthBackendCredentials(apiBaseUrl: unknown, apiManagementKey: unknown): boolean {
  return typeof apiBaseUrl === "string" && apiBaseUrl.trim() !== "" && typeof apiManagementKey === "string" && apiManagementKey.trim() !== "";
}

export function getPublicBackendErrorMessage(_status: number, _bodyText = ""): string {
  void _status;
  void _bodyText;
  return "Backend request failed";
}

export function getPublicUnexpectedErrorMessage(_error: unknown): string {
  void _error;
  return "Request failed";
}

export function getVertexCredentialFileError(file: { name?: unknown; size?: unknown }): string | null {
  if (typeof file.name !== "string" || !file.name.toLowerCase().endsWith(".json")) {
    return "Only JSON files are allowed";
  }

  if (typeof file.size !== "number" || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_VERTEX_CREDENTIAL_FILE_SIZE) {
    return "File is too large";
  }

  return null;
}
