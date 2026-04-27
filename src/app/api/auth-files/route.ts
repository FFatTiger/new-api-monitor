import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const API_MANAGEMENT_KEY = process.env.API_MANAGEMENT_KEY || "";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const KEY_LIKE_TOKEN_REGEX =
  /(sk-[A-Za-z0-9-_]{6,}|sk-ant-[A-Za-z0-9-_]{6,}|AIza[0-9A-Za-z-_]{8,}|AI[a-zA-Z0-9_-]{6,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;

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

function sanitizeStatusMessage(message: unknown): string | null {
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
  const prefixes = ["antigravity-", "codex-", "gemini-cli-"];
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

function extractProjectId(fileContent: Record<string, unknown>): string | null {
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

interface RawAuthFile {
  name: string;
  type?: string;
  provider?: string;
  authIndex?: number | string;
  auth_index?: number | string;
  runtimeOnly?: boolean | string;
  runtime_only?: boolean | string;
  statusMessage?: string;
  status_message?: string;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  id_token?: string | Record<string, unknown>;
  [key: string]: unknown;
}

interface SanitizedAuthFile {
  authIndex: string;
  displayName: string;
  type: string;
  provider: string;
  runtimeOnly: boolean;
  projectId: string | null;
  idToken: string | Record<string, unknown> | null;
  account: string | null;
  statusMessage: string | null;
}

async function fetchFileContent(name: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth-files/download?name=${encodeURIComponent(name)}`, {
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const text = await response.text();
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function sanitizeAuthFile(file: RawAuthFile, projectId: string | null): SanitizedAuthFile {
  const authIndex = String(file.authIndex ?? file.auth_index ?? "");
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

  return {
    authIndex,
    displayName: extractAndMaskAccountName(file.name),
    type: String(file.type || ""),
    provider: String(file.provider || ""),
    runtimeOnly,
    projectId,
    idToken: (file.id_token || metadata?.id_token || attributes?.id_token || null) as
      | string
      | Record<string, unknown>
      | null,
    account: (metadata?.account || attributes?.account || null) as string | null,
    statusMessage: sanitizeStatusMessage(rawStatusMessage),
  };
}

export async function GET() {
  if (!API_BASE_URL || !API_MANAGEMENT_KEY) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth-files`, {
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `Backend error: ${response.status} ${text}` }, { status: response.status });
    }

    const data = (await response.json()) as { files?: RawAuthFile[] };
    if (!Array.isArray(data.files)) {
      return NextResponse.json({ files: [] }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
    }

    const sanitizedFiles = await Promise.all(
      data.files.map(async (file) => {
        const type = (file.type || file.provider || "").toLowerCase();
        const isAntigravity = type.includes("antigravity");

        let projectId: string | null = null;
        if (isAntigravity) {
          const content = await fetchFileContent(file.name);
          projectId = content ? extractProjectId(content) || "bamboo-precept-lgxtn" : "bamboo-precept-lgxtn";
        }

        return sanitizeAuthFile(file, projectId);
      }),
    );

    return NextResponse.json(
      { files: sanitizedFiles },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
