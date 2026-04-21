import type { AuthFile } from "@/types/auth";
import type { ProviderType } from "@/types/quota";

import { fetchAntigravityQuota } from "@/lib/quota/antigravity";
import { fetchCodexQuota } from "@/lib/quota/codex";
import { fetchGeminiCliQuota } from "@/lib/quota/gemini-cli";
import { fetchKimiQuota } from "@/lib/quota/kimi";

export const getProviderType = (file: AuthFile): ProviderType => {
  const type = (file.type || file.provider || "").toLowerCase();

  if (type.includes("antigravity")) return "antigravity";
  if (type.includes("codex")) return "codex";
  if (type.includes("gemini") && type.includes("cli")) return "gemini-cli";
  if (type.includes("kimi")) return "kimi";

  return "unknown";
};

export const fetchQuotaForFile = async (file: AuthFile) => {
  const provider = getProviderType(file);

  if (provider === "antigravity") return fetchAntigravityQuota(file);
  if (provider === "codex") return fetchCodexQuota(file);
  if (provider === "gemini-cli") return fetchGeminiCliQuota(file);
  if (provider === "kimi") return fetchKimiQuota(file);

  throw new Error(`Unsupported provider: ${provider}`);
};
