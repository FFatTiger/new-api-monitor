import type { AuthFile } from "@/types/auth";
import type { ProviderFilter, QuotaState } from "@/types/quota";

import { normalizeCodexPlanType, resolveProviderType } from "./upstream.ts";

const UNKNOWN_CODEX_PLAN_RANK = 99;

export function getCodexPlanSortRank(file: AuthFile, quota?: QuotaState) {
  const planType = normalizeCodexPlanType(
    quota?.data?.plan_type ??
      quota?.data?.planType ??
      file.planType ??
      file.plan_type,
  );

  if (!planType) return UNKNOWN_CODEX_PLAN_RANK;
  if (planType.includes("prolite")) return 1;
  if (planType.includes("pro")) return 0;
  if (planType.includes("plus")) return 2;
  if (planType.includes("team")) return 3;
  if (planType.includes("enterprise")) return 4;
  if (planType.includes("free")) return 5;
  return UNKNOWN_CODEX_PLAN_RANK;
}

export function sortQuotaFiles(
  files: AuthFile[],
  quotas: Record<string, QuotaState>,
  selectedProvider: ProviderFilter,
) {
  return [...files].sort((a, b) => {
    const providerA = resolveProviderType(a);
    const providerB = resolveProviderType(b);

    if (selectedProvider === "all" && providerA !== providerB) {
      return providerA.localeCompare(providerB);
    }

    if (providerA === "codex" && providerB === "codex") {
      const planResult = getCodexPlanSortRank(a, quotas[a.authIndex]) - getCodexPlanSortRank(b, quotas[b.authIndex]);
      if (planResult !== 0) return planResult;
    }

    const nameResult = a.displayName.localeCompare(b.displayName);
    if (nameResult !== 0) return nameResult;
    return a.authIndex.localeCompare(b.authIndex);
  });
}
