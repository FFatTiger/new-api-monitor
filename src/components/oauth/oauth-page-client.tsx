"use client";

import { useEffect, useRef, useState } from "react";

import { AppHeader } from "@/components/navigation/app-header";
import { QuotaIcons } from "@/components/quota/quota-icons";
import type { OAuthProvider } from "@/lib/oauth/backend";
import { clearQuotaCache } from "@/lib/quota/cache";

type ProviderState = {
  url?: string;
  state?: string;
  status?: "waiting" | "success" | "error";
  error?: string;
  polling?: boolean;
  projectId?: string;
  callbackUrl?: string;
  callbackCode?: string;
  callbackState?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: "success" | "error";
  callbackError?: string;
};

type NotificationState = {
  message: string;
  tone: "success" | "error" | "warning";
};

type VertexImportState = {
  file?: File;
  fileName: string;
  location: string;
  loading: boolean;
  error?: string;
  result?: {
    projectId?: string;
    email?: string;
    location?: string;
    authFile?: string;
  };
};

type ProviderConfig = {
  id: OAuthProvider;
  title: string;
  eyebrow: string;
  hint: string;
  accentClass: string;
  callback: boolean;
  projectId?: boolean;
};

const providers: ProviderConfig[] = [
  {
    id: "codex",
    title: "Codex OAuth",
    eyebrow: "OpenAI",
    hint: "启动 Codex OAuth，保存账号凭据并同步到后端认证目录。",
    accentClass: "text-emerald-500",
    callback: true,
  },
  {
    id: "anthropic",
    title: "Claude OAuth",
    eyebrow: "Anthropic",
    hint: "启动 Claude OAuth，支持授权后粘贴回调 URL 完成远程登录。",
    accentClass: "text-orange-500",
    callback: true,
  },
  {
    id: "antigravity",
    title: "Antigravity OAuth",
    eyebrow: "Google",
    hint: "使用 Google 账号完成 Antigravity 登录，认证成功后可在 Quota 页查看配额。",
    accentClass: "text-amber-500",
    callback: true,
  },
  {
    id: "gemini-cli",
    title: "Gemini CLI OAuth",
    eyebrow: "Google",
    hint: "启动 Gemini CLI OAuth，可指定项目 ID、ALL 或 GOOGLE_ONE。",
    accentClass: "text-blue-500",
    callback: true,
    projectId: true,
  },
  {
    id: "xai",
    title: "Grok OAuth",
    eyebrow: "xAI",
    hint: "适配上游 xAI OAuth2 + PKCE 流程，支持 Grok CLI 凭据持久化。",
    accentClass: "text-fuchsia-500",
    callback: true,
  },
  {
    id: "kimi",
    title: "Kimi OAuth",
    eyebrow: "Device Flow",
    hint: "启动 Kimi 设备授权流程，打开链接后按页面提示完成认证。",
    accentClass: "text-violet-500",
    callback: false,
  },
];

const providerNames: Record<OAuthProvider, string> = {
  anthropic: "Claude",
  antigravity: "Antigravity",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  kimi: "Kimi",
  xai: "Grok",
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const Icons = {
  ArrowLeft: (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  ),
  Copy: (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  ),
  ExternalLink: (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  Key: (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  Send: (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  ),
  Upload: (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
};

function OAuthNotification({ notification }: { notification: NotificationState | null }) {
  if (!notification) return null;

  return (
    <div className="fixed right-4 top-4 z-50 max-w-sm">
      <div
        className={cx(
          "ds-overlay-card rounded-[16px] px-4 py-3 text-[0.82rem] shadow-[var(--shadow-overlay)]",
          notification.tone === "success" && "text-emerald-500",
          notification.tone === "warning" && "text-amber-500",
          notification.tone === "error" && "text-red-500",
        )}
      >
        {notification.message}
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: ProviderState }) {
  if (!state.status) return null;

  const label = state.status === "success" ? "认证成功" : state.status === "error" ? `认证失败：${state.error || "未知错误"}` : "等待认证";

  return (
    <div
      className={cx(
        "ds-pill mt-3 px-3 py-2 text-[0.72rem] font-medium",
        state.status === "success" && "text-emerald-500",
        state.status === "error" && "text-red-500",
        state.status === "waiting" && "text-blue-500",
      )}
    >
      {state.status === "waiting" ? <QuotaIcons.Refresh className="h-3.5 w-3.5 animate-spin" /> : null}
      {state.status === "success" ? <QuotaIcons.Check className="h-3.5 w-3.5" /> : null}
      {state.status === "error" ? <QuotaIcons.Alert className="h-3.5 w-3.5" /> : null}
      {label}
    </div>
  );
}

export function OAuthPageClient() {
  const [states, setStates] = useState<Record<string, ProviderState>>({});
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [vertexState, setVertexState] = useState<VertexImportState>({ fileName: "", location: "", loading: false });
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vertexFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      Object.values(activeTimers).forEach((timer) => clearInterval(timer));
      if (notificationTimer.current) {
        clearTimeout(notificationTimer.current);
      }
    };
  }, []);

  function showNotification(message: string, tone: NotificationState["tone"]) {
    setNotification({ message, tone });
    if (notificationTimer.current) {
      clearTimeout(notificationTimer.current);
    }
    notificationTimer.current = setTimeout(() => setNotification(null), 3200);
  }

  function updateProviderState(provider: OAuthProvider, next: Partial<ProviderState>) {
    setStates((previous) => ({
      ...previous,
      [provider]: { ...(previous[provider] || {}), ...next },
    }));
  }

  async function parseResponse(response: Response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text };
    }
  }

  function startPolling(provider: OAuthProvider, stateParam: string) {
    if (timers.current[provider]) {
      clearInterval(timers.current[provider]);
    }

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/oauth/status?state=${encodeURIComponent(stateParam)}`, {
          cache: "no-store",
        });
        const data = await parseResponse(response);

        if (!response.ok) {
          throw new Error(data.error || "Failed to read auth status");
        }

        if (data.status === "ok") {
          updateProviderState(provider, { status: "success", polling: false });
          clearQuotaCache();
          showNotification(`${providerNames[provider]} 认证成功`, "success");
          clearInterval(timer);
          delete timers.current[provider];
        } else if (data.status === "error") {
          updateProviderState(provider, { status: "error", error: data.error, polling: false });
          showNotification(`${providerNames[provider]} 认证失败：${data.error || "未知错误"}`, "error");
          clearInterval(timer);
          delete timers.current[provider];
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        updateProviderState(provider, { status: "error", error: message, polling: false });
        clearInterval(timer);
        delete timers.current[provider];
      }
    }, 3000);

    timers.current[provider] = timer;
  }

  async function startAuth(provider: OAuthProvider) {
    const projectId = provider === "gemini-cli" ? states[provider]?.projectId?.trim() : undefined;
    updateProviderState(provider, {
      status: "waiting",
      polling: true,
      error: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackUrl: "",
      callbackCode: "",
    });

    try {
      const response = await fetch("/api/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, projectId: projectId || undefined }),
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Failed to start auth");
      }

      updateProviderState(provider, {
        url: data.url,
        state: data.state,
        callbackState: data.state,
        status: "waiting",
        polling: true,
      });

      if (data.state) {
        startPolling(provider, data.state);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      updateProviderState(provider, { status: "error", error: message, polling: false });
      showNotification(`启动 ${providerNames[provider]} OAuth 失败：${message}`, "error");
    }
  }

  async function copyLink(url?: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showNotification("授权链接已复制", "success");
    } catch {
      showNotification("复制失败", "error");
    }
  }

  async function submitCallback(provider: OAuthProvider) {
    const state = states[provider] || {};
    const redirectUrl = state.callbackUrl?.trim() || "";
    const code = state.callbackCode?.trim() || "";
    const callbackState = state.callbackState?.trim() || state.state?.trim() || "";

    if (!redirectUrl && !code) {
      showNotification("请粘贴完整回调 URL，或填写 code", "warning");
      return;
    }

    updateProviderState(provider, { callbackSubmitting: true, callbackStatus: undefined, callbackError: undefined });

    try {
      const response = await fetch("/api/oauth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, redirectUrl, code, state: callbackState }),
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Callback submission failed");
      }

      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: "success" });
      showNotification("回调已提交，正在等待后端完成认证", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: "error", callbackError: message });
      showNotification(`提交回调失败：${message}`, "error");
    }
  }

  function handleVertexFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      showNotification("只支持 JSON 文件", "warning");
      event.target.value = "";
      return;
    }

    setVertexState((previous) => ({ ...previous, file, fileName: file.name, error: undefined, result: undefined }));
    event.target.value = "";
  }

  async function handleVertexImport() {
    if (!vertexState.file) {
      showNotification("请先选择服务账号 JSON", "warning");
      return;
    }

    setVertexState((previous) => ({ ...previous, loading: true, error: undefined, result: undefined }));

    try {
      const formData = new FormData();
      formData.append("file", vertexState.file);
      if (vertexState.location.trim()) {
        formData.append("location", vertexState.location.trim());
      }

      const response = await fetch("/api/vertex/import", {
        method: "POST",
        body: formData,
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Vertex import failed");
      }

      setVertexState((previous) => ({
        ...previous,
        loading: false,
        result: {
          projectId: data.projectId,
          email: data.email,
          location: data.location,
          authFile: data.authFile,
        },
      }));
      clearQuotaCache();
      showNotification("Vertex 凭据导入成功", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setVertexState((previous) => ({ ...previous, loading: false, error: message }));
      showNotification(`导入失败：${message}`, "error");
    }
  }

  const controls = (
    <a href="/quota" className="ds-button-secondary h-10 px-4 text-[0.8rem] font-medium">
      返回 Quota
    </a>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1240px] flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <OAuthNotification notification={notification} />
      <AppHeader controls={controls} subtitle="提交 OAuth 授权、远程回调与服务账号凭据导入。" />

      <section className="ds-panel grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-2">
          <p className="ds-kicker">Protected Mutation</p>
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">OAuth 登录会写入后端认证文件</h2>
          <p className="max-w-3xl text-[0.86rem] leading-6 text-[var(--foreground-soft)]">
            页面通过服务端 API 路由代理到管理后端，服务端使用已配置的 API 管理密钥转发请求。授权成功后会清理本地 Quota 缓存，刷新账号页即可看到新凭据。
          </p>
        </div>
        <div className="rounded-[18px] bg-[var(--background-muted)] p-4 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
          <p className="text-[0.78rem] font-medium text-[var(--foreground)]">远程回调用法</p>
          <p className="mt-2 text-[0.76rem] leading-5 text-[var(--foreground-soft)]">
            授权站点跳转到 localhost 回调地址时，把浏览器地址栏里的完整 URL 粘贴到对应卡片的回调框，然后提交。
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => {
          const state = states[provider.id] || {};
          return (
            <article key={provider.id} className="ds-card-muted ds-card-interactive flex h-full flex-col p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                  <div className={cx("rounded-[12px] bg-[var(--background-elevated)] p-2 shadow-[0_0_0_1px_var(--surface-ring-soft)]", provider.accentClass)}>
                    <Icons.Key className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="ds-kicker">{provider.eyebrow}</p>
                    <h3 className="mt-1 text-[0.96rem] font-semibold text-[var(--foreground)]">{provider.title}</h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void startAuth(provider.id)}
                  disabled={state.polling}
                  className="ds-button-primary min-h-10 shrink-0 px-3 text-[0.78rem] font-medium disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {state.polling ? <QuotaIcons.Refresh className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icons.Key className="mr-1.5 h-3.5 w-3.5" />}
                  {state.polling ? "等待中" : "开始认证"}
                </button>
              </div>

              <p className="mb-4 min-h-[40px] text-[0.78rem] leading-5 text-[var(--foreground-soft)]">{provider.hint}</p>

              {provider.projectId ? (
                <div className="mb-4">
                  <label htmlFor={`${provider.id}-project`} className="mb-1.5 block text-[0.72rem] font-medium text-[var(--foreground-soft)]">
                    项目 ID
                  </label>
                  <input
                    id={`${provider.id}-project`}
                    type="text"
                    value={state.projectId || ""}
                    onChange={(event) => updateProviderState(provider.id, { projectId: event.target.value })}
                    placeholder="留空自动选择，或填 ALL / GOOGLE_ONE"
                    className="ds-input px-3 py-2 text-[0.78rem]"
                  />
                </div>
              ) : null}

              {state.url ? (
                <div className="mb-4 rounded-[14px] bg-[var(--background-muted)] p-3 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
                  <p className="mb-2 text-[0.7rem] font-medium text-[var(--foreground-soft)]">授权链接</p>
                  <p className="break-all font-mono text-[0.68rem] leading-5 text-[var(--foreground-muted)]">{state.url}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyLink(state.url)} className="ds-button-secondary min-h-9 px-3 text-[0.72rem] font-medium">
                      <Icons.Copy className="mr-1.5 h-3.5 w-3.5" />
                      复制
                    </button>
                    <button type="button" onClick={() => window.open(state.url, "_blank", "noopener,noreferrer")} className="ds-button-secondary min-h-9 px-3 text-[0.72rem] font-medium">
                      <Icons.ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      打开
                    </button>
                  </div>
                </div>
              ) : null}

              {provider.callback && state.url ? (
                <div className="mt-auto space-y-3 rounded-[14px] bg-[var(--background-elevated)] p-3 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
                  <div>
                    <label htmlFor={`${provider.id}-callback-url`} className="mb-1.5 block text-[0.72rem] font-medium text-[var(--foreground-soft)]">
                      回调 URL
                    </label>
                    <input
                      id={`${provider.id}-callback-url`}
                      type="text"
                      value={state.callbackUrl || ""}
                      onChange={(event) => updateProviderState(provider.id, { callbackUrl: event.target.value, callbackStatus: undefined, callbackError: undefined })}
                      placeholder="http://127.0.0.1:56121/callback?code=...&state=..."
                      className="ds-input px-3 py-2 text-[0.74rem]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${provider.id}-code`} className="mb-1.5 block text-[0.72rem] font-medium text-[var(--foreground-soft)]">
                        Code
                      </label>
                      <input
                        id={`${provider.id}-code`}
                        type="text"
                        value={state.callbackCode || ""}
                        onChange={(event) => updateProviderState(provider.id, { callbackCode: event.target.value, callbackStatus: undefined, callbackError: undefined })}
                        placeholder="可选"
                        className="ds-input px-3 py-2 text-[0.74rem]"
                      />
                    </div>
                    <div>
                      <label htmlFor={`${provider.id}-state`} className="mb-1.5 block text-[0.72rem] font-medium text-[var(--foreground-soft)]">
                        State
                      </label>
                      <input
                        id={`${provider.id}-state`}
                        type="text"
                        value={state.callbackState || state.state || ""}
                        onChange={(event) => updateProviderState(provider.id, { callbackState: event.target.value, callbackStatus: undefined, callbackError: undefined })}
                        className="ds-input px-3 py-2 text-[0.74rem]"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitCallback(provider.id)}
                    disabled={state.callbackSubmitting}
                    className="ds-button-secondary min-h-10 w-full px-3 text-[0.78rem] font-medium disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {state.callbackSubmitting ? <QuotaIcons.Refresh className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icons.Send className="mr-1.5 h-3.5 w-3.5" />}
                    {state.callbackSubmitting ? "提交中" : "提交回调"}
                  </button>
                  {state.callbackStatus === "success" ? <p className="text-[0.72rem] text-emerald-500">回调已提交</p> : null}
                  {state.callbackStatus === "error" ? <p className="break-all text-[0.72rem] text-red-500">提交失败：{state.callbackError}</p> : null}
                </div>
              ) : null}

              <StatusPill state={state} />
            </article>
          );
        })}

        <article className="ds-card-muted ds-card-interactive flex h-full flex-col p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-start gap-3">
              <div className="rounded-[12px] bg-[var(--background-elevated)] p-2 text-indigo-500 shadow-[0_0_0_1px_var(--surface-ring-soft)]">
                <Icons.Upload className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="ds-kicker">Vertex AI</p>
                <h3 className="mt-1 text-[0.96rem] font-semibold text-[var(--foreground)]">Vertex JSON 导入</h3>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleVertexImport()}
              disabled={vertexState.loading}
              className="ds-button-primary min-h-10 shrink-0 px-3 text-[0.78rem] font-medium disabled:cursor-not-allowed disabled:opacity-45"
            >
              {vertexState.loading ? <QuotaIcons.Refresh className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icons.Upload className="mr-1.5 h-3.5 w-3.5" />}
              {vertexState.loading ? "导入中" : "导入"}
            </button>
          </div>

          <p className="mb-4 text-[0.78rem] leading-5 text-[var(--foreground-soft)]">上传 Google 服务账号 JSON，由后端写入 Vertex 凭据文件。</p>

          <div className="space-y-3">
            <div>
              <label htmlFor="vertex-location" className="mb-1.5 block text-[0.72rem] font-medium text-[var(--foreground-soft)]">
                目标区域
              </label>
              <input
                id="vertex-location"
                type="text"
                value={vertexState.location}
                onChange={(event) => setVertexState((previous) => ({ ...previous, location: event.target.value }))}
                placeholder="us-central1"
                className="ds-input px-3 py-2 text-[0.78rem]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[0.72rem] font-medium text-[var(--foreground-soft)]" htmlFor="vertex-file-display">
                服务账号密钥 JSON
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => vertexFileInputRef.current?.click()} className="ds-button-secondary min-h-10 px-3 text-[0.76rem] font-medium">
                  选择文件
                </button>
                <input
                  id="vertex-file-display"
                  type="text"
                  value={vertexState.fileName || "尚未选择文件"}
                  readOnly
                  className="ds-input flex-1 px-3 py-2 text-[0.74rem] text-[var(--foreground-soft)]"
                />
              </div>
              <input ref={vertexFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleVertexFileChange} />
            </div>
          </div>

          {vertexState.error ? <p className="mt-3 break-all text-[0.72rem] text-red-500">导入失败：{vertexState.error}</p> : null}
          {vertexState.result ? (
            <div className="mt-4 rounded-[14px] bg-[var(--background-elevated)] p-3 text-[0.74rem] shadow-[0_0_0_1px_var(--surface-ring-soft)]">
              <p className="mb-2 font-medium text-[var(--foreground)]">凭据已保存</p>
              <div className="space-y-1.5 text-[var(--foreground-soft)]">
                {vertexState.result.projectId ? <p>项目：{vertexState.result.projectId}</p> : null}
                {vertexState.result.email ? <p>账号：{vertexState.result.email}</p> : null}
                {vertexState.result.location ? <p>区域：{vertexState.result.location}</p> : null}
                {vertexState.result.authFile ? <p className="text-emerald-500">状态：{vertexState.result.authFile}</p> : null}
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}
