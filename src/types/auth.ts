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
}
