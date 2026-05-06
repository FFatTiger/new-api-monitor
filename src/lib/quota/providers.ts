import type { AuthFile } from "@/types/auth";
import type { ProviderType } from "@/types/quota";

import { fetchAntigravityQuota } from "@/lib/quota/antigravity";
import { fetchClaudeQuota } from "@/lib/quota/claude";
import { fetchCodexQuota } from "@/lib/quota/codex";
import { fetchGeminiCliQuota } from "@/lib/quota/gemini-cli";
import { fetchKimiQuota } from "@/lib/quota/kimi";
import { resolveProviderType } from "@/lib/quota/upstream";

export const getProviderType = (file: AuthFile): ProviderType => {
  return resolveProviderType(file);
};

export const fetchQuotaForFile = async (file: AuthFile) => {
  const provider = getProviderType(file);

  if (provider === "antigravity") return fetchAntigravityQuota(file);
  if (provider === "claude") return fetchClaudeQuota(file);
  if (provider === "codex") return fetchCodexQuota(file);
  if (provider === "gemini-cli") return fetchGeminiCliQuota(file);
  if (provider === "kimi") return fetchKimiQuota(file);

  throw new Error(`Unsupported provider: ${provider}`);
};
