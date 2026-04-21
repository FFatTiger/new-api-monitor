export interface AuthFile {
  authIndex: string;
  displayName: string;
  type: string;
  provider: string;
  runtimeOnly: boolean;
  projectId: string | null;
  idToken: string | Record<string, unknown> | null;
  account: string | null;
  statusMessage?: string | null;
}
