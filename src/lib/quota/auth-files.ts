import { parseIdTokenPayload } from "./parse-id-token.ts";
import { buildZaiAuthIndex, buildZaiDisplayName } from "./zai.ts";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const KEY_LIKE_TOKEN_REGEX =
  /(sk-[A-Za-z0-9-_]{6,}|sk-ant-[A-Za-z0-9-_]{6,}|AIza[0-9A-Za-z-_]{8,}|AI[a-zA-Z0-9_-]{6,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;

export interface RawAuthFile {
  name: string;
  type?: string;
  provider?: string;
  authIndex?: number | string;
  auth_index?: number | string;
  runtimeOnly?: boolean | string;
  runtime_only?: boolean | string;
  statusMessage?: string;
  status_message?: string;
  /** CPA 核心维护的累计计数，与 /usage 请求明细是两条记账路径。 */
  success?: string | number;
  failed?: string | number;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  id_token?: string | Record<string, unknown>;
  disabled?: boolean | string;
  unavailable?: boolean | string;
  planType?: string;
  plan_type?: string;
  [key: string]: unknown;
}

export interface SanitizedAuthFile {
  authIndex: string;
  displayName: string;
  type: string;
  provider: string;
  runtimeOnly: boolean;
  disabled: boolean;
  unavailable: boolean;
  projectId: string | null;
  statusMessage: string | null;
  planType: string | null;
  successCount?: number;
  failureCount?: number;
}

function toCount(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function maskString(value: string): string {
  if (!value) return value;

  const length = value.length;
  if (length <= 1) return "*";
  if (length === 2) return `${value[0]}*`;
  if (length === 3) return `${value[0]}*${value[2]}`;
  if (length === 4) return `${value[0]}*${value.slice(-2)}`;
  if (length === 5) return `${value.slice(0, 2)}*${value.slice(-2)}`;

  const first = value.slice(0, 2);
  const last = value.slice(-3);
  const maskLength = Math.min(length - 5, 6);
  return `${first}${"*".repeat(maskLength)}${last}`;
}

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return maskString(email);

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${maskString(local)}@${maskString(domain)}`;
}

export function sanitizeStatusMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;

  const trimmed = message.trim();
  if (!trimmed) return null;

  let sanitized = trimmed.replace(EMAIL_REGEX, (match) => maskEmail(match));
  sanitized = sanitized.replace(KEY_LIKE_TOKEN_REGEX, (match) => maskString(match));
  return sanitized;
}

function extractAndMaskAccountName(name: string): string {
  if (!name) return name;

  const base = name.replace(/\.json$/i, "");
  const prefixes = ["antigravity-", "claude-", "codex-", "gemini-cli-", "kimi-", "minimax-", "mini-max-", "xai-", "grok-", "zai-", "z-ai-", "z.ai-"];
  let remaining = base;

  for (const prefix of prefixes) {
    if (base.toLowerCase().startsWith(prefix)) {
      remaining = base.slice(prefix.length);
      break;
    }
  }

  if (remaining.includes("@")) {
    return maskEmail(remaining);
  }

  const underscoreParts = remaining.split("_");
  if (underscoreParts.length >= 2) {
    const lastPart = underscoreParts[underscoreParts.length - 1];
    const secondLastPart = underscoreParts[underscoreParts.length - 2];

    if (["com", "net", "org", "io"].includes(lastPart)) {
      return maskString(underscoreParts.slice(0, -2).join("_"));
    }

    if (["gmail", "outlook", "hotmail"].includes(secondLastPart)) {
      return maskString(underscoreParts.slice(0, -2).join("_"));
    }
  }

  return maskString(remaining);
}

export function extractProjectId(fileContent: Record<string, unknown>): string | null {
  let projectId = fileContent.project_id || fileContent.projectId;
  const installed = fileContent.installed as Record<string, unknown> | undefined;
  const web = fileContent.web as Record<string, unknown> | undefined;

  if (!projectId && installed) {
    projectId = installed.project_id || installed.projectId;
  }

  if (!projectId && web) {
    projectId = web.project_id || web.projectId;
  }

  return typeof projectId === "string" ? projectId : null;
}

export function normalizeAuthIndex(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildZaiAuthFile(apiKey: unknown, slot = 0, total = 1): SanitizedAuthFile | null {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return null;

  return {
    authIndex: buildZaiAuthIndex(slot),
    displayName: buildZaiDisplayName(key, total),
    type: "zai",
    provider: "zai",
    runtimeOnly: false,
    disabled: false,
    unavailable: false,
    projectId: null,
    statusMessage: null,
    planType: null,
  };
}

function getMiniMaxDisplayName(region: unknown) {
  const normalized = typeof region === "string" ? region.trim().toLowerCase() : "";
  if (["cn", "china", "domestic", "mainland"].includes(normalized)) return "MiniMax CN";
  if (["global", "intl", "international", "overseas"].includes(normalized)) return "MiniMax Global";
  return "MiniMax";
}

export function buildMiniMaxAuthFile(apiKey: unknown, region: unknown): SanitizedAuthFile | null {
  if (typeof apiKey !== "string" || !apiKey.trim()) return null;

  return {
    authIndex: "server-minimax",
    displayName: getMiniMaxDisplayName(region),
    type: "minimax",
    provider: "minimax",
    runtimeOnly: false,
    disabled: false,
    unavailable: false,
    projectId: null,
    statusMessage: null,
    planType: null,
  };
}

export function sanitizeAuthFile(file: RawAuthFile, projectId: string | null): SanitizedAuthFile {
  const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
  const runtimeOnly = Boolean(file.runtimeOnly || file.runtime_only);
  const metadata = file.metadata as Record<string, unknown> | undefined;
  const attributes = file.attributes as Record<string, unknown> | undefined;
  const rawStatusMessage =
    file.status_message ??
    file.statusMessage ??
    metadata?.status_message ??
    metadata?.statusMessage ??
    attributes?.status_message ??
    attributes?.statusMessage;
  const tokenPayload = parseIdTokenPayload(file.id_token ?? metadata?.id_token ?? attributes?.id_token);

  return {
    authIndex,
    displayName: extractAndMaskAccountName(file.name),
    type: String(file.type || ""),
    provider: String(file.provider || ""),
    runtimeOnly,
    disabled: file.disabled === true || file.disabled === "true",
    unavailable: file.unavailable === true || file.unavailable === "true",
    projectId,
    statusMessage: sanitizeStatusMessage(rawStatusMessage),
    successCount: toCount(file.success),
    failureCount: toCount(file.failed),
    planType: (file.planType ||
      file.plan_type ||
      metadata?.planType ||
      metadata?.plan_type ||
      attributes?.planType ||
      attributes?.plan_type ||
      tokenPayload?.planType ||
      tokenPayload?.plan_type ||
      null) as string | null,
  };
}
