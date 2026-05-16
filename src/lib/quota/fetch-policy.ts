type QuotaFetchFile = {
  type?: unknown;
  provider?: unknown;
  runtimeOnly?: unknown;
  runtime_only?: unknown;
  disabled?: unknown;
  unavailable?: unknown;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
};

const resolveFetchProvider = (file: QuotaFetchFile) => {
  return normalizeString(file.type) || normalizeString(file.provider) || "unknown";
};

export function getQuotaFetchSkipReason(file: QuotaFetchFile): string | null {
  const provider = resolveFetchProvider(file);

  if (provider === "gemini-cli" && Boolean(file.runtimeOnly || file.runtime_only)) {
    return "Runtime-only (Skipped)";
  }

  if (provider === "xai" || provider === "x-ai" || provider === "x.ai" || provider === "grok") {
    return "Grok quota unavailable (Skipped)";
  }

  return null;
}
