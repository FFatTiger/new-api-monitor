const integerFormatter = new Intl.NumberFormat("zh-CN");

export function getCacheRatio(inputTokens: number, cacheTokens: number) {
  if (inputTokens <= 0 || !Number.isFinite(inputTokens) || !Number.isFinite(cacheTokens)) {
    return 0;
  }

  return Math.max(0, Math.min(1, cacheTokens / inputTokens));
}

export function formatOutputTokensPerSec(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return "-";
  }

  return integerFormatter.format(Math.round(value));
}
