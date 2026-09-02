export interface AuthFile {
  authIndex: string;
  displayName: string;
  type: string;
  provider: string;
  runtimeOnly: boolean;
  projectId: string | null;
  statusMessage?: string | null;
  disabled?: boolean;
  unavailable?: boolean;
  planType?: string | null;
  plan_type?: string | null;
  /** 后端维护的请求计数（与 CPA 管理页同源）；运行时凭元无此字段。 */
  successCount?: number;
  failureCount?: number;
}
